/**
 * @module QueueManager
 * @description Unified script to manage Redis download/scrape queues (clear, dump, or check status).
 * @constraints
 *   - Use centralized configuration injection.
 *   - Follow robust error handling and ensure Redis connections are closed.
 *   - Follow Strict OOP principles.
 * @dependencies Redis (ioredis), fs, path
 * @lastUpdated 2026-06-12
 */

import Redis from "ioredis";
import * as fs from "fs";
import * as path from "path";

/**
 * Manages configuration and environment variables for the queue script.
 */
export class QueueConfig {
  public readonly redisUrl: string;
  public readonly dumpFilePath: string;

  constructor() {
    this.redisUrl = process.env.REDIS_URL || "redis://redis:6379";
    this.dumpFilePath =
      process.env.DUMP_FILE_PATH || "/app/data/queue_dump.json";
  }
}

/**
 * Scans Redis for all scrape_queue* keys, active processing sets, and dead letter queues, and deletes them.
 */
export class QueueClearer {
  private readonly config: QueueConfig;

  constructor(config: QueueConfig) {
    this.config = config;
  }

  public async clear(): Promise<void> {
    console.log(
      `🔌 [QueueClearer] Connecting to Redis at ${this.config.redisUrl}...`,
    );
    const redis = new Redis(this.config.redisUrl);

    try {
      const scrapeQueueKeys = await redis.keys("scrape_queue*");
      const siteQueueKeys = await redis.keys("sites:*:scrape:*");
      const keys = Array.from(new Set([...scrapeQueueKeys, ...siteQueueKeys]));
      const keysToClear = [...keys];

      const activeProcessingExists = await redis.exists("active_processing");
      if (activeProcessingExists) {
        keysToClear.push("active_processing");
      }

      const deadLetterExists = await redis.exists("dead_letter_queue");
      if (deadLetterExists) {
        keysToClear.push("dead_letter_queue");
      }

      if (keysToClear.length === 0) {
        console.log(
          "ℹ️ [QueueClearer] No download queues or active sets found in Redis to clear.",
        );
        return;
      }

      console.log(
        `🧹 [QueueClearer] Found ${keysToClear.length} key(s) to clear:`,
      );
      for (const key of keysToClear) {
        console.log(`  - ${key}`);
      }

      const deletedCount = await redis.del(...keysToClear);
      console.log(
        `✅ [QueueClearer] Successfully cleared download queues. Deleted ${deletedCount} Redis keys.`,
      );
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        `❌ [QueueClearer] Failed to clear queues: ${error.message}`,
      );
    } finally {
      await redis.quit();
      console.log("🔌 [QueueClearer] Connection closed.");
    }
  }
}

/**
 * Scans Redis for all scrape_queue* keys, fetches all items, and saves them to a structured JSON file.
 */
export class QueueDumper {
  private readonly config: QueueConfig;

  constructor(config: QueueConfig) {
    this.config = config;
  }

  public async dump(): Promise<void> {
    console.log(
      `🔌 [QueueDumper] Connecting to Redis at ${this.config.redisUrl}...`,
    );
    const redis = new Redis(this.config.redisUrl);

    try {
      const scrapeQueueKeys = await redis.keys("scrape_queue*");
      const siteQueueKeys = await redis.keys("sites:*:scrape:*");
      const keys = Array.from(new Set([...scrapeQueueKeys, ...siteQueueKeys]));
      if (keys.length === 0) {
        console.log("ℹ️ [QueueDumper] No active scrape queues found in Redis.");
        return;
      }

      console.log(
        `🔍 [QueueDumper] Found ${keys.length} active queue key(s). Starting extraction...`,
      );

      const dumpData: Record<string, any[]> = {};
      let totalItems = 0;

      for (const key of keys.sort()) {
        const type = await redis.type(key);
        if (type !== "list") {
          console.log(
            `ℹ️ [QueueDumper] Skipping non-list key '${key}' (type: ${type}).`,
          );
          continue;
        }

        const len = await redis.llen(key);
        console.log(
          `📥 [QueueDumper] Queue [${key}] ➡️ Length: ${len} items. Fetching...`,
        );

        const rawItems = await redis.lrange(key, 0, -1);
        const parsedItems: any[] = [];

        for (const item of rawItems) {
          try {
            parsedItems.push(JSON.parse(item));
          } catch {
            parsedItems.push({ raw: item });
          }
        }

        dumpData[key] = parsedItems;
        totalItems += len;
      }

      const destDir = path.dirname(this.config.dumpFilePath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      console.log(
        `💾 [QueueDumper] Saving aggregated dump of ${totalItems} items to ${this.config.dumpFilePath}...`,
      );
      const payload = {
        dumpedAt: new Date().toISOString(),
        totalQueuesCount: Object.keys(dumpData).length,
        totalItemsCount: totalItems,
        queues: dumpData,
      };

      fs.writeFileSync(
        this.config.dumpFilePath,
        JSON.stringify(payload, null, 2),
        "utf-8",
      );
      console.log(`✅ [QueueDumper] Dump completed successfully!`);

      console.log(`\n📋 [QueueDumper] Summary of dumped queues:`);
      console.log("==================================================");
      for (const [key, items] of Object.entries(dumpData)) {
        console.log(` 📝 Queue: [${key}] ➡️ Length: ${items.length} items`);
      }
      console.log("==================================================\n");
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`❌ [QueueDumper] Dump failed: ${error.message}`);
    } finally {
      await redis.quit();
      console.log("🔌 [QueueDumper] Connection closed.");
    }
  }
}

/**
 * Scans for active Redis scrape queues/sets and prints status metrics.
 */
export class QueueStatusChecker {
  private readonly config: QueueConfig;

  constructor(config: QueueConfig) {
    this.config = config;
  }

  public async check(): Promise<void> {
    console.log(
      `🔌 [QueueStatus] Connecting to Redis at ${this.config.redisUrl}...`,
    );
    const redis = new Redis(this.config.redisUrl);

    try {
      const scrapeQueueKeys = await redis.keys("scrape_queue*");
      const siteQueueKeys = await redis.keys("sites:*:scrape:*");
      const keys = Array.from(new Set([...scrapeQueueKeys, ...siteQueueKeys]));
      if (keys.length === 0) {
        console.log("ℹ️ [QueueStatus] No active scrape queues found in Redis.");
        return;
      }

      console.log(
        `\n📊 [QueueStatus] Found ${keys.length} active queue key(s):`,
      );
      console.log("==================================================");
      for (const key of keys.sort()) {
        const type = await redis.type(key);
        if (type === "list") {
          const len = await redis.llen(key);
          console.log(` 📝 Queue: [${key}] ➡️ Length: ${len} items`);
        } else if (type === "set") {
          const size = await redis.scard(key);
          console.log(` 📁 Set: [${key}] ➡️ Size: ${size} items`);
        } else {
          console.log(` ❓ Key: [${key}] ➡️ Type: ${type}`);
        }
      }
      console.log("==================================================\n");
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        `❌ [QueueStatus] Error checking queue status: ${error.message}`,
      );
    } finally {
      await redis.quit();
      console.log("🔌 [QueueStatus] Connection closed.");
    }
  }
}

// Execution Entry Point
if (require.main === module) {
  const args = process.argv.slice(2);
  const runClear = args.includes("--clear") || args.includes("-c");
  const runDump = args.includes("--dump") || args.includes("-d");
  const runStatus =
    args.includes("--status") || args.includes("-s") || (!runClear && !runDump);

  const config = new QueueConfig();

  (async () => {
    if (runClear) {
      await new QueueClearer(config).clear();
    }
    if (runDump) {
      await new QueueDumper(config).dump();
    }
    if (runStatus) {
      await new QueueStatusChecker(config).check();
    }
  })().catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`❌ [QueueManager] Fatal Error: ${error.message}`);
    process.exit(1);
  });
}
