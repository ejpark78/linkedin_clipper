/**
 * @module BaseListService
 * @description Core functionality or script runner for BaseListService.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies ioredis, mongo
 * @lastUpdated 2026-06-11
 */

import Redis from "ioredis";
import { MongoDatabase } from "../database/mongo";
import { AppConfig } from "../config/AppConfig";

export interface BaseListConfig {
  site: string;
  displayName: string;
  cacheSetKey: string;
  bronzeHtmlCollection: `bronze/${string}`;
  urlsCollection: `bronze/${string}`;
}

export abstract class BaseListService {
  protected redis!: Redis;
  protected config: BaseListConfig;

  constructor(config: BaseListConfig) {
    this.config = config;
    // Automatically upgrade legacy completion cache keys to the unified namespace layout
    if (
      !this.config.cacheSetKey ||
      this.config.cacheSetKey.startsWith("completed_")
    ) {
      this.config.cacheSetKey = `sites:${this.config.site}:completed`;
    }
  }

  async init(): Promise<void> {
    const redisUrl = AppConfig.REDIS_URL;
    this.redis = new Redis(redisUrl);
    console.log(
      `📡 [${this.config.displayName} List] Connected to Redis for queueing.`,
    );
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
    try {
      await MongoDatabase.getInstance().close();
    } catch (err: any) {
      console.warn(`⚠️ Error closing MongoDB connection: ${err.message}`);
    }
  }

  async seedCache(): Promise<void> {
    const completedCount = await this.redis.scard(this.config.cacheSetKey);
    if (completedCount === 0) {
      try {
        console.log(
          `🔍 [${this.config.displayName} List] Redis cache is empty. Seeding from MongoDB...`,
        );
        const db = MongoDatabase.getInstance();
        const bronzeColl = await db.getCollection(
          this.config.bronzeHtmlCollection,
        );
        const cursor = bronzeColl.find({}, { projection: { id: 1, _id: 0 } });
        let seedCount = 0;
        for await (const doc of cursor) {
          if (doc.id) {
            await this.redis.sadd(this.config.cacheSetKey, doc.id);
            seedCount++;
          }
        }
        if (seedCount > 0) {
          console.log(
            `📡 [${this.config.displayName} List] Seeded ${seedCount} completed IDs into Redis cache.`,
          );
        }
      } catch (err: any) {
        console.warn(`⚠️ MongoDB seed skipped or failed: ${err.message}`);
      }
    }
  }

  async processItem(
    id: string,
    url: string,
    title: string,
    extras?: Record<string, any>,
  ): Promise<boolean> {
    const { site, displayName, cacheSetKey, urlsCollection } = this.config;
    const overwrite = AppConfig.OVERWRITE;

    if (overwrite) {
      await this.redis.srem(cacheSetKey, id);
    }
    const isCompleted = overwrite
      ? false
      : await this.redis.sismember(cacheSetKey, id);

    const db = MongoDatabase.getInstance();
    const urlsColl = await db.getCollection(urlsCollection);

    const updateDoc: any = {
      $set: {
        id,
        url,
        title,
        status: isCompleted ? "completed" : "new",
        updatedAt: new Date(),
        ...(extras || {}),
      },
    };

    if (overwrite) {
      updateDoc.$set.pushedToRedis = false;
    } else {
      updateDoc.$setOnInsert = { pushedToRedis: isCompleted ? true : false };
    }

    await urlsColl.updateOne({ id }, updateDoc, { upsert: true });

    if (isCompleted) {
      console.log(
        `⏭️ [${displayName} List] Skipping already completed item: [ID: ${id}] ${title}`,
      );
      return false;
    }

    const doc = await urlsColl.findOne({ id });
    const alreadyPushed = doc?.pushedToRedis || false;

    if (!alreadyPushed) {
      const priority = AppConfig.PRIORITY;
      const scraperSlackVal = AppConfig.SCRAPER_SLACK;

      const payload: Record<string, any> = {
        site,
        url,
        attempt: 1,
        priority,
      };
      if (scraperSlackVal > 0) {
        payload.scraperSlack = scraperSlackVal;
      }

      await this.redis.rpush(
        `sites:${site}:scrape:${priority}`,
        JSON.stringify(payload),
      );
      await urlsColl.updateOne({ id }, { $set: { pushedToRedis: true } });
      console.log(
        `🚀 [${displayName} List] Queued (Force Overwrite: ${overwrite}): [ID: ${id}] ${title} -> ${url}`,
      );
      return true;
    }

    return false;
  }

  abstract run(page?: number): Promise<number>;
}
