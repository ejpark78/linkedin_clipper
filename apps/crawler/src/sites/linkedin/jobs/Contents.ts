/**
 * @module Contents
 * @description Core functionality or script runner for Contents.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path, BasePipeline, LinkedInMarkdownConverter, LinkedInCrawler, UrlUtils
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import { BasePipeline } from "../../../core/BasePipeline";
import { LinkedInMarkdownConverter } from "./Converter";
import { LinkedInCrawler } from "../Crawler";
import { UrlUtils } from "../../../utils";
import { AppConfig } from "../../../config/AppConfig";
import { descriptor, JobMeta } from "./site.config";

export class LinkedInJobsContents extends BasePipeline<JobMeta> {
  private readonly converter: LinkedInMarkdownConverter;

  constructor() {
    super();
    this.converter = new LinkedInMarkdownConverter();
  }

  protected extractId(url: string): string {
    return UrlUtils.extractJobId(url) || "";
  }

  protected getDomainName(): string {
    return "채용공고";
  }

  protected async executeScrape(
    url: string,
    tempHtmlPath: string,
  ): Promise<void> {
    const crawler = new LinkedInCrawler({
      login: AppConfig.USE_LOGIN,
    });
    await crawler.scrapeJob(url, tempHtmlPath);
  }

  protected async processMetadata(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<JobMeta> {
    return this.converter.convertHtmlToMarkdown(htmlContent, id, url);
  }

  protected async saveResults(
    meta: JobMeta,
    id: string,
    tempHtmlPath: string,
    redisInstance?: any,
  ): Promise<{ targetDirName: string }> {
    const { MongoDatabase } = require("../../../database/mongo");
    const mongo = MongoDatabase.getInstance();

    // Save to Bronze Collection
    const bronzeColl = await mongo.getCollection(
      descriptor.scraper?.collectionName || "bronze/linkedin.jobs",
      "bronze",
    );
    await bronzeColl.updateOne(
      { jobId: id },
      {
        $set: {
          jobId: id,
          html: fs.readFileSync(tempHtmlPath, "utf-8"),
          collectedAt: new Date(),
        },
      },
      { upsert: true },
    );

    // Update URL Status
    const statusCollName =
      descriptor.converter?.statusCollection || "bronze/linkedin.job_urls";
    const jobUrlsColl = await mongo.getCollection(statusCollName as any);
    await jobUrlsColl.updateOne(
      { jobId: id },
      { $set: { status: "completed", updatedAt: new Date() } },
    );

    // Save to Silver Collection
    if (!descriptor.targetLoader) {
      throw new Error(
        `TargetLoader configuration missing in descriptor for site: ${descriptor.key}`,
      );
    }
    const doc = descriptor.targetLoader.buildDocument(id, meta);
    const silverColl = await mongo.getCollection(
      descriptor.targetLoader.collectionName,
    );
    await silverColl.updateOne({ jobId: id }, { $set: doc }, { upsert: true });

    // Mark completed in Redis if needed
    if (redisInstance && descriptor.converter?.completedSetKey) {
      await redisInstance.sadd(descriptor.converter.completedSetKey, id);
    }

    return { targetDirName: descriptor.key };
  }
}

if (require.main === module) {
  (async () => {
    const pipeline = new LinkedInJobsContents();
    try {
      await pipeline.run();
    } catch (err: any) {
      console.error(`❌ Pipeline 실행 실패: ${err.message}`);
      process.exit(1);
    }
  })();
}
