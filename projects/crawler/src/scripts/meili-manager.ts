/**
 * @file meili-manager.ts
 * @description Command-line tool to manage Meilisearch resources, configuration, and index state.
 * Supports updating index settings, incremental refresh, and full index reset.
 *
 * Rules Complied:
 * - OOP Patterns: Utilizes MeiliSearchDatabase and MongoDatabase singleton wrappers.
 * - Robust Error Handling: Diagnostic logging with proper connection cleanups in finally blocks.
 * - Strict Typing: Typed variables and standard TypeScript conventions.
 */

import Redis from "ioredis";
import { MongoDatabase } from "../database/mongo";
import { MeiliSearchDatabase } from "../database/meili";
import { getAllSites, getIndexName } from "../core/SiteRegistry";

const INDEX_NAME = "contents";

async function manage(): Promise<void> {
  const args = process.argv.slice(2);
  const shouldClean =
    args.includes("--clean") ||
    args.includes("--reset") ||
    args.includes("--reindex");
  let targetSiteKey = "";
  const siteIdx = args.indexOf("--site");
  if (siteIdx !== -1 && args[siteIdx + 1]) {
    targetSiteKey = args[siteIdx + 1];
  }

  console.log(
    `🚀 Starting Meilisearch Manager (Mode: ${shouldClean ? "RESET/CLEAN REBUILD" : "INCREMENTAL REFRESH"}, Site: ${targetSiteKey || "ALL"})...`,
  );

  const mongo = MongoDatabase.getInstance();
  const meili = MeiliSearchDatabase.getInstance();
  const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
  const redis = new Redis(redisUrl);

  try {
    // Step 1: Ensure Meilisearch is reachable
    const isHealthy = await meili.isHealthy();
    if (!isHealthy) {
      throw new Error("Meilisearch service is not healthy or unreachable.");
    }
    console.log("✅ Meilisearch connection established.");

    let sites = getAllSites();
    if (targetSiteKey) {
      sites = sites.filter((s) => s.key === targetSiteKey);
      if (sites.length === 0) {
        throw new Error(`Site "${targetSiteKey}" not found in SiteRegistry.`);
      }
    }

    // Step 2 & 3: Initialize settings and clean/reset indexes for each site
    if (shouldClean) {
      console.log(
        "🧹 Clearing Redis index queue (index_queue & dead_letter_queue)...",
      );
      await redis.del("index_queue", "dead_letter_queue");
      console.log("✅ Redis index queue cleared.");
    }

    for (const site of sites) {
      if (!site.targetLoader) continue;
      const indexName = getIndexName(site.key);

      console.log(`⚙️ Setting up index configuration for "${indexName}"...`);
      await meili.updateSettings(indexName, {
        searchableAttributes: [
          "title",
          "companyName",
          "location",
          "geo",
          "content",
        ],
        filterableAttributes: ["site", "geo", "location"],
        sortableAttributes: ["publishedAt", "updatedAt"],
        rankingRules: [
          "words",
          "typo",
          "proximity",
          "attribute",
          "sort",
          "exactness",
        ],
      });
      console.log(
        `✅ Index settings initialized successfully for "${indexName}".`,
      );

      if (shouldClean) {
        console.log(`🧹 Clearing all documents from index "${indexName}"...`);
        await (meili as any).request(
          `/indexes/${indexName}/documents`,
          "DELETE",
        );
        console.log(`✅ Index "${indexName}" cleared successfully.`);
      }
    }

    // Step 4: Fetch MongoDB collections and synchronize documents
    await mongo.connect();

    let totalProcessed = 0;

    for (const site of sites) {
      if (!site.targetLoader) continue;

      const collectionName = site.targetLoader.collectionName;
      console.log(
        `📂 Processing collection: [${collectionName}] for site: [${site.key}]...`,
      );

      try {
        const collection = await mongo.getCollection(collectionName);
        const filterField = site.targetLoader.filterField;
        const cursor = collection
          .find({})
          .project({ [filterField]: 1, id: 1, _id: 1 });
        const indexTasks: string[] = [];
        let siteProcessedCount = 0;

        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          if (!doc) continue;

          const docId = doc[filterField] || doc.id || doc._id;
          if (docId) {
            indexTasks.push(
              JSON.stringify({ site: site.key, id: String(docId) }),
            );
          }

          if (indexTasks.length >= 1000) {
            await redis.rpush("index_queue", ...indexTasks);
            siteProcessedCount += indexTasks.length;
            indexTasks.length = 0; // Clear array
          }
        }

        if (indexTasks.length > 0) {
          await redis.rpush("index_queue", ...indexTasks);
          siteProcessedCount += indexTasks.length;
        }

        if (siteProcessedCount === 0) {
          console.log(`  ℹ️ No documents found in ${collectionName}.`);
        } else {
          console.log(
            `  ✅ Successfully queued ${siteProcessedCount} indexing tasks for ${collectionName}`,
          );
          totalProcessed += siteProcessedCount;
        }
      } catch (collErr: any) {
        console.error(
          `  ❌ Failed to process collection ${collectionName}: ${collErr.message}`,
        );
      }
    }

    console.log(
      `\n🎉 Meilisearch indexing completed successfully! Total documents processed: ${totalProcessed}`,
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Meilisearch Manager failed: ${errorMsg}`);
    process.exit(1);
  } finally {
    await mongo.close();
    await redis.quit();
  }
}

manage();
