/**
 * @module UrlFixer
 * @description Cleans up URLs matching TARGET_PATTERN from a configured MongoDB collection and Redis queues.
 * @constraints
 *   - Must use centralized CleanupConfig injection instead of direct process.env access.
 *   - Close both MongoDB and Redis connections in finally blocks to prevent connection leaks.
 *   - Follow Strict OOP: run operations using the IUrlCleaner interface.
 *   - Configuration parameters (site key, collection, pattern) must be set via top-level global constants.
 * @dependencies MongoDB, Redis (ioredis)
 * @lastUpdated 2026-06-11
 */

import { MongoDatabase } from "../database/mongo";
import Redis from "ioredis";

// ==============================================================================
// ⚙️ GLOBAL CLEANUP CONFIGURATION
// ==============================================================================
const SITE_KEY = "geeknews"; // 사이트 식별자 (큐 검사 및 식별용)
const MONGO_COLLECTION = `bronze/${SITE_KEY}.urls`; // 대상 몽고디비 컬렉션명 (예: 'bronze/uppity.urls')
const TARGET_PATTERN: RegExp = /news.ycombinator.com/i; // 삭제할 URL 정규식 패턴

// 검사 및 청소할 Redis 큐 키 목록
const REDIS_QUEUE_KEYS: string[] = [
  `sites:${SITE_KEY}:scrape:high`,
  `sites:${SITE_KEY}:scrape:medium`,
  `sites:${SITE_KEY}:scrape:low`,
  "scrape_queue", // 레거시 공용 큐
];
// ==============================================================================

/**
 * Rule 4: Centralized Config
 * Manages configuration and environment variables for the cleanup scripts.
 */
export class CleanupConfig {
  public readonly mongoUrl: string;
  public readonly redisUrl: string;

  constructor() {
    this.mongoUrl = process.env.MONGO_URL || "mongodb://mongodb:27017";
    this.redisUrl = process.env.REDIS_URL || "redis://redis:6379";
  }
}

/**
 * Rule 1: Strict OOP Patterns
 * Interface defining URL cleaning contracts.
 */
export interface IUrlCleaner {
  clean(): Promise<void>;
}

/**
 * Rule 1 & 2: Strict OOP implementation with strong typing.
 * Cleans both MongoDB and Redis queues of matching URLs.
 */
export class UrlFixer implements IUrlCleaner {
  private readonly config: CleanupConfig;

  constructor(config: CleanupConfig) {
    this.config = config;
  }

  public async clean(): Promise<void> {
    console.log(
      `🧼 [UrlFixer] Starting cleanup operations for site [${SITE_KEY}]...`,
    );
    console.log(`📋 Target Collection: ${MONGO_COLLECTION}`);
    console.log(`🔍 Target Pattern: ${TARGET_PATTERN}`);

    await this.cleanMongo();
    await this.cleanRedis();
    console.log("✨ [UrlFixer] Cleanup operations complete.");
  }

  /**
   * Rule 3: Robust Error Handling & Finally cleanups
   */
  private async cleanMongo(): Promise<void> {
    const mongo = MongoDatabase.getInstance();
    try {
      await mongo.connect();
      const urlsColl = await mongo.getCollection(
        MONGO_COLLECTION as `${"bronze" | "silver"}/${string}`,
      );
      const query = { url: { $regex: TARGET_PATTERN } };
      const matchCount = await urlsColl.countDocuments(query);

      console.log(
        `🔍 [MongoDB] Found ${matchCount} matching documents in ${MONGO_COLLECTION}.`,
      );
      if (matchCount > 0) {
        const deleteResult = await urlsColl.deleteMany(query);
        console.log(
          `✅ [MongoDB] Successfully deleted ${deleteResult.deletedCount} documents.`,
        );
      } else {
        console.log("ℹ️ [MongoDB] No documents match the criteria.");
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        `❌ [MongoDB] Error during cleanup: ${error.message}`,
        error,
      );
    } finally {
      await mongo.close();
    }
  }

  /**
   * Rule 3: Robust Error Handling & Finally cleanups
   */
  private async cleanRedis(): Promise<void> {
    console.log(`🔌 [Redis] Connecting to ${this.config.redisUrl}...`);
    const redis = new Redis(this.config.redisUrl);

    try {
      for (const key of REDIS_QUEUE_KEYS) {
        const exists = await redis.exists(key);
        if (!exists) {
          console.log(`ℹ️ [Redis] Queue '${key}' does not exist.`);
          continue;
        }

        const type = await redis.type(key);
        if (type !== "list") {
          console.log(`ℹ️ [Redis] Key '${key}' is not a list (type: ${type}).`);
          continue;
        }

        const len = await redis.llen(key);
        if (len === 0) {
          console.log(`ℹ️ [Redis] Queue '${key}' is empty.`);
          continue;
        }

        const items = await redis.lrange(key, 0, -1);
        const keepItems: string[] = [];
        let removedCount = 0;

        for (const item of items) {
          try {
            const parsed: Record<string, unknown> = JSON.parse(item);
            const isTargetSite =
              key.includes(SITE_KEY) || parsed.site === SITE_KEY;
            const hasMatch =
              typeof parsed.url === "string" && TARGET_PATTERN.test(parsed.url);

            if (isTargetSite && hasMatch) {
              removedCount++;
            } else {
              keepItems.push(item);
            }
          } catch {
            if (TARGET_PATTERN.test(item)) {
              removedCount++;
            } else {
              keepItems.push(item);
            }
          }
        }

        if (removedCount > 0) {
          console.log(
            `🗑️ [Redis] Found ${removedCount} matching items in '${key}'. Cleaning...`,
          );
          await redis.del(key);
          if (keepItems.length > 0) {
            await redis.rpush(key, ...keepItems);
          }
          console.log(
            `✅ [Redis] Cleaned queue '${key}' (Remaining: ${keepItems.length}).`,
          );
        } else {
          console.log(`ℹ️ [Redis] No matching items in queue '${key}'.`);
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        `❌ [Redis] Error during queue cleanup: ${error.message}`,
        error,
      );
    } finally {
      await redis.quit();
      console.log("🔌 [Redis] Connection closed.");
    }
  }
}

// Execution Entry Point
const config = new CleanupConfig();
const cleaner = new UrlFixer(config);
cleaner.clean().catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`❌ Fatal Error during execution: ${error.message}`, error);
  process.exit(1);
});
