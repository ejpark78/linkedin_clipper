/**
 * @module BaseRefreshConvert
 * @description Core functionality or script runner for BaseRefreshConvert.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies mongo, ioredis
 * @lastUpdated 2026-06-15
 */

import { MongoDatabase } from "../database/mongo";
import Redis from "ioredis";
import { getSite } from "./SiteRegistry";
import { AppConfig } from "../config/AppConfig";

export interface RefreshConvertConfig {
  site: string;
  bronzeCollection: `bronze/${string}`;
  silverCollection?: `silver/${string}`;
  idExtract?: (doc: any) => string | null;
  includeUrlInPayload?: boolean;
}

export class BaseRefreshConvert {
  constructor(protected config: RefreshConvertConfig) {}

  public async run(): Promise<void> {
    const { site, bronzeCollection, includeUrlInPayload } = this.config;
    const desc = getSite(site);
    const idField = desc?.scraper?.updateFilterKey ?? "id";
    const silverCollection =
      this.config.silverCollection ??
      desc?.targetLoader?.collectionName ??
      (`silver/${site}.contents` as `silver/${string}`);
    const REDIS_URL = AppConfig.REDIS_URL;
    const CONVERT_QUEUE = "convert_queue";
    const BATCH_SIZE = 500;

    console.log(
      `🔄 [Refresh Convert] Pushing ${site} items from bronze to convert_queue...`,
    );
    const mongo = MongoDatabase.getInstance();
    await mongo.connect();

    const redis = new Redis(REDIS_URL);

    try {
      const reset = AppConfig.RESET;
      const overwrite = AppConfig.OVERWRITE || reset;
      const completedIds = new Set<string>();

      const silverColl = await mongo.getCollection(silverCollection);
      if (reset) {
        console.log(
          `🧹 RESET=true — clearing all documents from ${silverCollection} before rebuild...`,
        );
        await silverColl.deleteMany({});
        console.log(`✅ Cleared ${silverCollection}.`);
      }

      if (!overwrite) {
        const completed = await silverColl.distinct(idField);
        completed.forEach((id) => completedIds.add(String(id)));
        console.log(
          `📥 Loaded ${completedIds.size} already completed ${site} IDs from Silver Layer using ID field '${idField}'.`,
        );
      } else {
        console.log(
          `⚠️ ${reset ? "RESET" : "OVERWRITE"}=true — skipping Silver Layer check.`,
        );
      }

      const bronzeColl = await mongo.getCollection(bronzeCollection);
      const cursor = bronzeColl.find({});
      const total = await bronzeColl.countDocuments();
      console.log(`📥 Found ${total} documents in ${bronzeCollection}.`);

      let count = 0;

      while (await cursor.hasNext()) {
        const batch: string[] = [];
        while ((await cursor.hasNext()) && batch.length < BATCH_SIZE) {
          const doc = await cursor.next();
          if (!doc) continue;
          const id = this.config.idExtract
            ? this.config.idExtract(doc)
            : doc[idField] || doc.id || null;
          if (!id) continue;

          if (!overwrite && completedIds.has(String(id))) continue;

          const payload: Record<string, any> = {
            site,
            id,
            bronze_db: "bronze",
            bronze_collection: bronzeCollection.replace("bronze/", ""),
            bronze_id: doc._id.toString(),
            timestamp: new Date().toISOString(),
          };
          if (includeUrlInPayload && doc.url) {
            payload.url = doc.url;
          }

          batch.push(JSON.stringify(payload));
        }

        if (batch.length > 0) {
          await redis.rpush(CONVERT_QUEUE, ...batch);
          count += batch.length;
          console.log(`🚀 Queued ${count}/${total} ${site} convert tasks.`);
        }
      }

      console.log(`✅ Done. Total ${count} ${site} convert tasks queued.`);
    } catch (e: any) {
      console.error("❌ Failed to queue convert tasks:", e);
    } finally {
      await redis.quit();
      await mongo.close();
      process.exit(0);
    }
  }
}
