/**
 * @module ConverterWorker
 * @description Core functionality or script runner for ConverterWorker.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies os, fs, path, ioredis, mongo
 * @lastUpdated 2026-06-15
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import Redis from "ioredis";
import { MongoDatabase } from "../database/mongo";
import { UrlUtils, NamingUtils, Logger, FormatUtils } from "../utils";
import { getSite } from "../core/SiteRegistry";
import { TargetLoader } from "./TargetLoader";
import { AppConfig } from "../config/AppConfig";

const REDIS_URL = AppConfig.REDIS_URL;
const CONVERT_QUEUE = "convert_queue";
const INDEX_QUEUE = "index_queue";
const ACTIVE_PROCESSING_SET = "active_processing";
const DEAD_LETTER_QUEUE = "dead_letter_queue";

function touchHeartbeat(): void {
  try {
    const hbPath = "/tmp/converter-heartbeat";
    fs.writeFileSync(hbPath, new Date().toISOString(), "utf-8");
  } catch {}
}

let redisClient: Redis | null = null;
const mongoDb = MongoDatabase.getInstance();

async function shutdown(signal: string) {
  Logger.info(`[Converter] Received ${signal}. Starting graceful shutdown...`);
  try {
    if (redisClient) {
      await redisClient.quit();
      Logger.info("[Converter] Redis connection closed.");
    }
    await mongoDb.close();
    Logger.info("[Converter] MongoDB connection closed.");
    process.exit(0);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    Logger.error(`[Converter] Error during shutdown: ${errorMsg}`);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function main() {
  Logger.info(`Connecting to Redis at ${REDIS_URL}...`);
  redisClient = new Redis(REDIS_URL);
  const redis = redisClient;
  const mongo = mongoDb;
  await mongo.connect();

  Logger.info(`Converter Worker started, listening to: ${CONVERT_QUEUE}`);
  touchHeartbeat();

  while (true) {
    try {
      touchHeartbeat();
      const res = await redis.blpop(CONVERT_QUEUE, 5);
      if (!res) continue;

      const payloadRaw = res[1].trim();
      if (!payloadRaw) continue;

      const task: {
        site: string;
        id: string;
        bronze_db?: string;
        bronze_collection?: string;
        bronze_id: string;
        attempt?: number;
      } = JSON.parse(payloadRaw);
      const { site, id, bronze_id } = task;
      const attempt = task.attempt || 1;

      Logger.info(
        `[Converter] POP task [${site}] ID: ${id} (Bronze Ref: ${bronze_id})`,
      );

      await Logger.contextStorage.run({ site, url: bronze_id }, async () => {
        try {
          const desc = getSite(site);
          if (!desc?.converter) {
            throw new Error(`No converter configuration for site: ${site}`);
          }

          const tf = desc.converter;
          const dbName = task.bronze_db || "bronze";
          let collectionName = task.bronze_collection;
          if (!collectionName) {
            collectionName = tf.targetCollection;
          }

          const pathSpec =
            `${dbName}/${collectionName}` as `${"bronze" | "silver"}/${string}`;
          const bronzeColl = await mongo.getCollection(pathSpec);

          const filter = tf.filter(id);
          const rawDoc = await bronzeColl.findOne(filter);

          if (!rawDoc) {
            throw new Error(
              `Raw document not found in ${pathSpec} for ID ${id}`,
            );
          }

          let rawContent: string;
          if (rawDoc.rawHtml) {
            rawContent = rawDoc.rawHtml;
          } else if (rawDoc.rawJson) {
            rawContent =
              typeof rawDoc.rawJson === "string"
                ? rawDoc.rawJson
                : JSON.stringify(rawDoc.rawJson);
          } else {
            throw new Error(
              `No rawHtml or rawJson found in ${pathSpec} for ID ${id}`,
            );
          }

          const converter = tf.converter;
          let meta: any = await converter.convertHtmlToMarkdown(
            rawContent,
            id,
            rawDoc.url || "",
          );

          if (meta.rawContent) {
            meta.rawContent = FormatUtils.cleanMarkdownLinks(meta.rawContent);
          }
          if (meta.content) {
            meta.content = FormatUtils.cleanMarkdownLinks(meta.content);
          }

          if (
            site === "pytorch_kr" &&
            (!meta.content?.trim() || meta.content === `${meta.title}\n`)
          ) {
            Logger.info(
              `[Converter] Content empty for [${site}] ID: ${id}, trying JSON API fallback...`,
            );
            const hasJsonFallback = converter as unknown as {
              fetchAndConvertFromJsonApi?: (
                url: string,
                id: string,
              ) => Promise<typeof meta>;
            };
            if (
              typeof hasJsonFallback.fetchAndConvertFromJsonApi === "function"
            ) {
              const jsonMeta = await hasJsonFallback.fetchAndConvertFromJsonApi(
                rawDoc.url || "",
                id,
              );
              if (jsonMeta) {
                meta = jsonMeta;
                Logger.info(
                  `[Converter] JSON API fallback succeeded for [${site}] ID: ${id}`,
                );
              }
            }
          }

          if (site !== "linkedin") {
            try {
              const { downloadImages } =
                await import("../utils/imageDownloader");
              const publishedAt = meta.publishedAt || rawDoc.publishedAt;

              const { processedUrls } = await downloadImages({
                htmlContent: rawContent,
                markdown: meta.rawContent || "",
                publishedAt: publishedAt || undefined,
                docId: id,
                siteDir: site,
                siteDomain: desc.domain || "",
                refererUrl: rawDoc.url || meta.url || "",
                removeFavicons:
                  desc.refreshSilver?.imageDownload?.removeFavicons ?? true,
              });

              // Keep the original markdown unchanged in meta.rawContent
              let updatedMarkdown = meta.rawContent || "";
              let updatedContent = meta.content || "";

              // If we have downloaded images, append the mappings to the bottom of the markdown
              if (processedUrls && Object.keys(processedUrls).length > 0) {
                let mappingSection = "\n\n---\n### Collected Images\n";
                for (const [originalSrc, localUrl] of Object.entries(
                  processedUrls,
                )) {
                  mappingSection += `- \`${originalSrc}\` -> \`${localUrl}\`\n`;
                }
                updatedMarkdown += mappingSection;
                updatedContent += mappingSection;
              }

              meta.rawContent = updatedMarkdown;
              meta.content = updatedContent;

              let year = "unknown";
              let month = "unknown";
              if (publishedAt) {
                const d = new Date(publishedAt);
                if (!isNaN(d.getTime())) {
                  year = d.getFullYear().toString();
                  month = String(d.getMonth() + 1).padStart(2, "0");
                }
              }

              const projectRoot = path.resolve(__dirname, "..", "..", "..");
              const baseDir = path.join(
                projectRoot,
                "data",
                "sites",
                site,
                year,
                month,
              );
              const htmlDir = path.join(baseDir, "html");
              const mdDir = path.join(baseDir, "markdown");

              fs.mkdirSync(htmlDir, { recursive: true });
              fs.mkdirSync(mdDir, { recursive: true });

              fs.writeFileSync(
                path.join(htmlDir, `${id}.html`),
                rawContent,
                "utf-8",
              );
              if (typeof converter.prettifyAndSave === "function") {
                await converter.prettifyAndSave(
                  meta.rawContent,
                  path.join(mdDir, `${id}.md`),
                );
              }

              if (desc.refreshSilver?.saveJson) {
                const jsonDir = path.join(baseDir, "json");
                fs.mkdirSync(jsonDir, { recursive: true });
                fs.writeFileSync(
                  path.join(jsonDir, `${id}.json`),
                  rawContent,
                  "utf-8",
                );
              }

              Logger.info(
                `[Converter] Processed images and saved local files for [${site}] ID: ${id}`,
              );
            } catch (imgErr: unknown) {
              const errorMsg =
                imgErr instanceof Error ? imgErr.message : String(imgErr);
              Logger.warn(
                `[Converter] Local file save or image download failed for [${site}] ID: ${id}: ${errorMsg}`,
                imgErr,
              );
            }
          }

          await TargetLoader.load(site, id, meta);

          // Queue task for Meilisearch indexing
          const indexTask = {
            site,
            id,
            timestamp: new Date().toISOString(),
          };
          await redis.rpush(INDEX_QUEUE, JSON.stringify(indexTask));
          Logger.info(
            `[Converter] Published Meilisearch index task for [${site}] ID: ${id}`,
          );

          if (tf.statusCollection) {
            const statusFilter = tf.statusFilterField
              ? { [tf.statusFilterField]: id }
              : { id };
            const statusColl = await mongo.getCollection(
              tf.statusCollection as `${"bronze" | "silver"}/${string}`,
            );
            await statusColl.updateOne(statusFilter, {
              $set: { status: "completed", updatedAt: new Date() },
            });
          }

          const cacheUrl = rawDoc.url || "";
          if (cacheUrl) {
            await redis.srem(ACTIVE_PROCESSING_SET, cacheUrl);
          }

          await redis.sadd(tf.completedSetKey, id);

          Logger.info(
            `[Converter] Successfully completed pipeline for [${site}] ID: ${id}`,
            {
              title: meta.jobTitle || meta.title || "Untitled",
              company: meta.company || meta.companyName || "N/A",
              location: meta.rawLocation || meta.location || "N/A",
              url: rawDoc.url || "",
            },
          );
        } catch (transErr: unknown) {
          const errorMsg =
            transErr instanceof Error ? transErr.message : String(transErr);
          Logger.error(
            `[Converter] Conversion failed for [${site}] ID: ${id} on attempt ${attempt}`,
            transErr,
          );

          if (attempt < 3) {
            const retryTask = { site, id, bronze_id, attempt: attempt + 1 };
            await redis.rpush(CONVERT_QUEUE, JSON.stringify(retryTask));
            Logger.info(
              `[Converter] Re-queued task to retry. Attempt: ${attempt + 1}`,
            );
          } else {
            const deadTask = {
              site,
              id,
              bronze_id,
              error: errorMsg,
              failedAt: new Date().toISOString(),
            };
            await redis.rpush(DEAD_LETTER_QUEUE, JSON.stringify(deadTask));
            Logger.error(
              `[Converter] Max retry attempts exceeded. Moved convert ID: ${id} to dead_letter_queue`,
            );
          }
        }
      });
    } catch (loopErr: unknown) {
      const errorMsg =
        loopErr instanceof Error ? loopErr.message : String(loopErr);
      Logger.error(`[Converter] Worker loop exception: ${errorMsg}`, loopErr);
    }
  }
}

main().catch((err: unknown) => {
  Logger.error("Fatal crash on Converter Worker", err);
  process.exit(1);
});
