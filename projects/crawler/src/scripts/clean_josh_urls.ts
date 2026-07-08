/**
 * @module clean_josh_urls
 * @description One-off cleanup script to remove non-josh URLs from MongoDB and Redis queue for maily_josh.
 */

import { MongoDatabase } from "../database/mongo";
import Redis from "ioredis";

const SITE_KEY = "maily_josh";
const MONGO_COLLECTION = `bronze/${SITE_KEY}.urls` as const;
const REDIS_QUEUE_KEYS = [
  `sites:${SITE_KEY}:scrape:high`,
  `sites:${SITE_KEY}:scrape:medium`,
  `sites:${SITE_KEY}:scrape:low`,
  "scrape_queue",
];

async function clean() {
  console.log(`🧼 Starting maily_josh url cleanup...`);

  // 1. Clean MongoDB
  const mongo = MongoDatabase.getInstance();
  try {
    await mongo.connect();
    const urlsColl = await mongo.getCollection(MONGO_COLLECTION);

    // Find documents that do NOT start with https://maily.so/josh
    const query = { url: { $not: /^https:\/\/maily\.so\/josh/ } };
    const matchCount = await urlsColl.countDocuments(query);
    console.log(
      `🔍 [MongoDB] Found ${matchCount} non-josh URLs in ${MONGO_COLLECTION}`,
    );

    if (matchCount > 0) {
      const result = await urlsColl.deleteMany(query);
      console.log(`✅ [MongoDB] Deleted ${result.deletedCount} documents.`);
    }
  } catch (err: any) {
    console.error(`❌ [MongoDB] Error: ${err.message}`);
  } finally {
    await mongo.close();
  }

  // 2. Clean Redis
  const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
  const redis = new Redis(redisUrl);
  try {
    for (const key of REDIS_QUEUE_KEYS) {
      const exists = await redis.exists(key);
      if (!exists) continue;

      const len = await redis.llen(key);
      if (len === 0) continue;

      const items = await redis.lrange(key, 0, -1);
      const keepItems: string[] = [];
      let removedCount = 0;

      for (const item of items) {
        try {
          const parsed = JSON.parse(item);
          const isTargetSite =
            key.includes(SITE_KEY) || parsed.site === SITE_KEY;
          const matchesJosh =
            typeof parsed.url === "string" &&
            parsed.url.startsWith("https://maily.so/josh");

          if (isTargetSite && !matchesJosh) {
            removedCount++;
          } else {
            keepItems.push(item);
          }
        } catch {
          if (!item.includes("https://maily.so/josh")) {
            removedCount++;
          } else {
            keepItems.push(item);
          }
        }
      }

      if (removedCount > 0) {
        console.log(
          `🗑️ [Redis] Cleaning ${removedCount} non-josh items from '${key}'`,
        );
        await redis.del(key);
        if (keepItems.length > 0) {
          await redis.rpush(key, ...keepItems);
        }
        console.log(`✅ [Redis] Done. (Remaining: ${keepItems.length})`);
      } else {
        console.log(`ℹ️ [Redis] No matching items to clean in '${key}'`);
      }
    }
  } catch (err: any) {
    console.error(`❌ [Redis] Error: ${err.message}`);
  } finally {
    await redis.quit();
  }
}

clean().catch(console.error);
