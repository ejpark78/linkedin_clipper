/**
 * @module ScraperWorker
 * @description Listens to Redis queues, fetches HTML from target pages, and stores raw data in MongoDB.
 * @constraints
 *   - Follows robust error handling and handles temporary scraper task retries.
 *   - Skips retry attempts for permanent HTTP errors (such as 404 Not Found) to avoid redundant requests.
 *   - Sanitizes and corrects protocol-less external links during recursive discovery to avoid invalid relative resolution.
 *   - Pre-processes scraped HTML anchor links by removing surrounding quotes to avoid relative resolution bugs.
 * @dependencies Redis, MongoDB, UrlUtils, SiteRegistry
 * @lastUpdated 2026-06-11
 */

import * as os from "os";
import Redis from "ioredis";

import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { MongoDatabase } from "../database/mongo";
import { UrlUtils, Logger } from "../utils";
const { stripTrackingParams, isBinaryUrl, extractDomainUrl } = UrlUtils;
import { getSite, getAllSites } from "../core/SiteRegistry";
import { AppConfig } from "../config/AppConfig";

const REDIS_URL = AppConfig.REDIS_URL;
const SCRAPE_QUEUE = "scrape_queue";
const CONVERT_QUEUE = "convert_queue";
const ACTIVE_PROCESSING_SET = "active_processing";
const DEAD_LETTER_QUEUE = "dead_letter_queue";

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

interface ScrapePayload {
  site: string;
  url: string;
  attempt: number;
  priority?: "high" | "medium" | "low";
  scraperSlack?: number;
  recursive?: boolean;
}

class ScraperDispatcher {
  public async scrape(
    site: string,
    url: string,
    tempPath: string,
  ): Promise<void> {
    const desc = getSite(site);
    if (!desc?.scraper) {
      throw new Error(`Unsupported site scraper: ${site}`);
    }
    await desc.scraper.scrape(url, tempPath);
  }
}

class QueueManager {
  private scrapeSiteKeys: string[];
  private highQueues: string[];
  private mediumQueues: string[];
  private lowQueues: string[];
  private legacyQueues = ["scrape_queue"];

  constructor() {
    this.scrapeSiteKeys = getAllSites()
      .filter((s) => s.scraper)
      .map((s) => s.key);
    this.highQueues = this.buildQueues("high");
    this.mediumQueues = this.buildQueues("medium");
    this.lowQueues = this.buildQueues("low");
  }

  private buildQueues(priority: string): string[] {
    return this.scrapeSiteKeys.map((key) => `sites:${key}:scrape:${priority}`);
  }

  public getActiveQueues(): string[] {
    return [
      ...this.shuffleArray(this.highQueues),
      ...this.shuffleArray(this.mediumQueues),
      ...this.shuffleArray(this.lowQueues),
      ...this.legacyQueues,
    ];
  }

  private shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

class ScraperWorker {
  private redis: Redis;
  private redisBlocking: Redis;
  private mongo: MongoDatabase;
  private dispatcher: ScraperDispatcher;
  private queueManager: QueueManager;

  constructor() {
    this.redis = new Redis(REDIS_URL);
    this.redisBlocking = new Redis(REDIS_URL);
    this.mongo = MongoDatabase.getInstance();
    this.dispatcher = new ScraperDispatcher();
    this.queueManager = new QueueManager();
  }

  private touchHeartbeat(): void {
    try {
      const hbPath = "/tmp/scraper-heartbeat";
      fs.writeFileSync(hbPath, new Date().toISOString(), "utf-8");
    } catch {}
  }

  public async start(): Promise<void> {
    Logger.info(`Connecting to Redis at ${REDIS_URL}...`);
    await this.mongo.connect();
    Logger.info(`Scraper Worker started, listening to: ${SCRAPE_QUEUE}`);
    this.touchHeartbeat();

    while (true) {
      try {
        this.touchHeartbeat();
        const activeQueues = this.queueManager.getActiveQueues();
        const res = await this.redisBlocking.blpop(...activeQueues, 5);
        if (!res) continue;

        const queueName = res[0];
        const payloadRaw = res[1].trim();
        if (!payloadRaw) continue;

        await this.processMessage(queueName, payloadRaw);
      } catch (loopErr: unknown) {
        const errorMsg =
          loopErr instanceof Error ? loopErr.message : String(loopErr);
        Logger.error(`[Scraper] Worker loop exception: ${errorMsg}`, loopErr);
      }
    }
  }

  private async processMessage(
    queueName: string,
    payloadRaw: string,
  ): Promise<void> {
    let payload: ScrapePayload;
    try {
      payload = JSON.parse(payloadRaw);
    } catch (err) {
      payload = { site: "linkedin", url: payloadRaw, attempt: 1 };
    }

    let { site, url, scraperSlack } = payload;
    url = UrlUtils.stripTrackingParams(url);
    await Logger.contextStorage.run({ site, url }, async () => {
      const desc = getSite(site);

      if (!desc?.scraper) {
        Logger.error(`Unsupported site payload received: ${site}`, { url });
        return;
      }

      const config = desc.scraper;

      if (desc.domain) {
        try {
          const parsed = new URL(url);
          if (!UrlUtils.isSameDomain(parsed.hostname, desc.domain)) {
            Logger.warn(
              `[Scraper] Skipping URL outside configured domain for [${site}]: ${url} (hostname: ${parsed.hostname})`,
            );
            return;
          }
        } catch {
          Logger.error(`[Scraper] Invalid URL for [${site}]: ${url}`);
          return;
        }
      }

      if (config.urlFilter && !config.urlFilter(url)) {
        Logger.warn(
          `[Scraper] Skipping URL outside custom filter for [${site}]: ${url}`,
        );
        return;
      }

      // Check site-specific exclude patterns
      if (config.excludePatterns && config.excludePatterns.length > 0) {
        if (config.excludePatterns.some((pat) => url.includes(pat))) {
          Logger.info(`URL matches exclude patterns for [${site}]. Skipping.`, {
            url,
          });
          return;
        }
      }

      const id = config.extractId(url);
      if (!id) {
        Logger.info(
          `Invalid URL pattern. Cannot extract ID for site: ${site}. Skipping.`,
          { url },
        );
        return;
      }

      Logger.info(
        `[Scraper] POP target [${site}] ID: ${id} from queue: ${queueName}`,
        { url, queue: queueName },
      );

      const tempHtmlPath = path.join(
        os.tmpdir(),
        `temp_raw_${site}_${id}.html`,
      );
      try {
        await this.checkAndApplyRateLimit(site, scraperSlack);
        await withTimeout(
          this.dispatcher.scrape(site, url, tempHtmlPath),
          120000,
          `Scraping execution timed out after 120000ms for [${site}]`,
        );

        if (
          !fs.existsSync(tempHtmlPath) ||
          fs.statSync(tempHtmlPath).size === 0
        ) {
          throw new Error("Downloaded raw HTML content is empty.");
        }

        const rawHtml = fs.readFileSync(tempHtmlPath, "utf-8");
        fs.unlinkSync(tempHtmlPath);

        this.logHtmlPreview(site, id, url, rawHtml);
        await this.saveRawHtmlAndQueueConvertTask(
          site,
          id,
          url,
          rawHtml,
          payload,
        );
      } catch (scrapeErr: unknown) {
        await this.handleScrapeFailure(payload, id, scrapeErr);
      }
    });
  }

  private async checkAndApplyRateLimit(
    site: string,
    scraperSlack?: number,
  ): Promise<void> {
    const desc = getSite(site);
    const defaultSlack = desc?.scraper?.defaultSlack ?? 3;
    const slackSeconds =
      scraperSlack !== undefined ? scraperSlack : defaultSlack;
    if (slackSeconds <= 0) return;

    const now = Date.now();
    const rateLimitKey = `last_scrape_time:${site}`;
    const lastScrapeTimeRaw = await this.redis.get(rateLimitKey);
    const lastScrapeTime = lastScrapeTimeRaw
      ? parseInt(lastScrapeTimeRaw, 10)
      : 0;

    const minInterval = slackSeconds * 1000;
    const timePassed = now - lastScrapeTime;

    if (timePassed < minInterval) {
      const delay = minInterval - timePassed;
      Logger.info(
        `[Scraper] [${site}] Rate-limit active. Delaying for ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    await this.redis.set(rateLimitKey, Date.now().toString());
  }

  private logHtmlPreview(
    site: string,
    id: string,
    url: string,
    rawHtml: string,
  ): void {
    try {
      const $ = cheerio.load(rawHtml);
      const bodyText = $("body")
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 500);
      Logger.info(
        `[Scraper] HTML Content Preview [${site}] ID: ${id} URL: ${url} (First 500 chars of body text): "${bodyText}"`,
      );
    } catch (logErr) {}
  }

  private async saveRawHtmlAndQueueConvertTask(
    site: string,
    id: string,
    url: string,
    rawHtml: string,
    payload?: ScrapePayload,
  ): Promise<void> {
    const desc = getSite(site);
    if (!desc?.scraper) {
      throw new Error(`Configuration not found for site: ${site}`);
    }

    const config = desc.scraper;
    const collection = await this.mongo.getCollection(config.collectionName);
    const updateFilter = { [config.updateFilterKey]: id };
    const updatePayload = {
      ...updateFilter,
      id,
      url,
      rawHtml,
      scrapedAt: new Date(),
    };

    const updateResult = await collection.updateOne(
      updateFilter,
      { $set: updatePayload },
      { upsert: true },
    );

    const dbRefId = updateResult.upsertedId
      ? updateResult.upsertedId.toString()
      : id;

    const convertTask = {
      site,
      id,
      bronze_db: "bronze",
      bronze_collection: config.targetCollection,
      bronze_id: dbRefId,
      timestamp: new Date().toISOString(),
    };

    await this.redis.rpush(CONVERT_QUEUE, JSON.stringify(convertTask));
    Logger.info(
      `[Scraper] Successfully saved Raw HTML and published convert event for ID: ${id}`,
    );
  }

  private async handleScrapeFailure(
    payload: ScrapePayload,
    id: string,
    scrapeErr: unknown,
  ): Promise<void> {
    const { site, url, attempt, scraperSlack } = payload;
    const errorMsg =
      scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
    Logger.error(
      `[Scraper] Scrape execution failed for [${site}] ID: ${id} on attempt ${attempt}`,
      scrapeErr,
    );

    const isPermanentError = errorMsg.includes("HTTP status 404");

    if (attempt < 3 && !isPermanentError) {
      const priority = payload.priority || "medium";
      const retryTask: ScrapePayload = {
        site,
        url,
        attempt: attempt + 1,
        priority,
        ...(scraperSlack !== undefined ? { scraperSlack } : {}),
      };
      const targetQueue = `sites:${site}:scrape:${priority}`;

      if (priority === "high") {
        await this.redis.lpush(targetQueue, JSON.stringify(retryTask));
      } else {
        await this.redis.rpush(targetQueue, JSON.stringify(retryTask));
      }
      Logger.info(
        `[Scraper] Re-queued task to ${targetQueue} retry. Attempt: ${attempt + 1}`,
      );
    } else {
      const deadTask = {
        site,
        url,
        error: errorMsg,
        failedAt: new Date().toISOString(),
      };
      await this.redis.rpush(DEAD_LETTER_QUEUE, JSON.stringify(deadTask));
      await this.redis.srem(ACTIVE_PROCESSING_SET, url);
      const desc = getSite(site);
      if (desc?.scraper?.urlsCollectionName) {
        const urlsColl = await this.mongo.getCollection(
          desc.scraper.urlsCollectionName as `${"bronze" | "silver"}/${string}`,
        );
        const statusVal = isPermanentError ? "failed_permanent" : "failed";
        await urlsColl.updateOne(
          { id },
          {
            $set: { status: statusVal, failedAt: new Date(), error: errorMsg },
          },
          { upsert: true },
        );
      }
      Logger.error(
        `[Scraper] Max retry attempts exceeded. Moved ID: ${id} to dead_letter_queue and marked as failed in urls`,
      );
    }

    if (errorMsg.includes("세션 만료") || errorMsg.includes("Auth Wall")) {
      Logger.error(
        `LinkedIn Session expired. Graceful shut down of scraper.`,
        scrapeErr,
      );
      await this.shutdown("Session Expired");
    }
  }

  public async shutdown(signal: string): Promise<void> {
    Logger.info(`[Scraper] Received ${signal}. Starting graceful shutdown...`);
    try {
      await Promise.all([this.redis.quit(), this.redisBlocking.quit()]);
      Logger.info("[Scraper] Redis connections closed.");
      await this.mongo.close();
      Logger.info("[Scraper] MongoDB connection closed.");
      process.exit(0);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      Logger.error(`[Scraper] Error during shutdown: ${errorMsg}`);
      process.exit(1);
    }
  }
}

const worker = new ScraperWorker();

process.on("SIGTERM", () => worker.shutdown("SIGTERM"));
process.on("SIGINT", () => worker.shutdown("SIGINT"));

worker.start().catch((err: unknown) => {
  Logger.error("Fatal crash on Scraper Worker", err);
  process.exit(1);
});
