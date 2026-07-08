/**
 * @module Contents
 * @description Core functionality or script runner for Contents.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path, BasePipeline, CompanyMarkdownConverter, LinkedInCrawler
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import { BasePipeline } from "../../../core/BasePipeline";
import { CompanyMarkdownConverter } from "./Converter";
import { CompanyMeta } from "./site.config";
import { LinkedInCrawler } from "../Crawler";
import { AppConfig } from "../../../config/AppConfig";

export class LinkedInCompanyContents extends BasePipeline<CompanyMeta> {
  private readonly converter: CompanyMarkdownConverter;

  constructor() {
    super();
    this.converter = new CompanyMarkdownConverter();
  }

  protected extractId(url: string): string {
    const match = url.match(/linkedin\.com\/company\/([^\/]+)/);
    return match ? match[1] : "";
  }

  protected getDomainName(): string {
    return "회사정보";
  }

  protected async executeScrape(
    url: string,
    tempHtmlPath: string,
  ): Promise<void> {
    const crawler = new LinkedInCrawler({
      login: AppConfig.USE_LOGIN,
    });
    await crawler.scrapeCompanyAbout(url, tempHtmlPath);
  }

  protected async processMetadata(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<CompanyMeta> {
    return this.converter.convertHtmlToMarkdown(htmlContent, id, url);
  }

  protected async saveResults(
    meta: CompanyMeta,
    id: string,
    tempHtmlPath: string,
    redisInstance?: any,
  ): Promise<{ targetDirName: string }> {
    const { MongoDatabase } = require("../../../database/mongo");
    const mongo = MongoDatabase.getInstance();
    const config = require("./site.config").descriptor;

    // Save to Bronze Collection
    const bronzeColl = await mongo.getCollection(
      config.converter.targetCollection || "linkedin.companies",
      "bronze",
    );
    await bronzeColl.updateOne(
      { companyId: id },
      {
        $set: {
          companyId: id,
          html: fs.readFileSync(tempHtmlPath, "utf-8"),
          collectedAt: new Date(),
        },
      },
      { upsert: true },
    );

    // Update URL Status
    const companyUrlsColl = await mongo.getCollection(
      "bronze/linkedin.company_urls",
    );
    await companyUrlsColl.updateOne(
      { companyId: id },
      { $set: { status: "completed", updatedAt: new Date() } },
    );

    // Save to Silver Collection
    const doc = config.targetLoader.buildDocument(id, meta);
    const silverColl = await mongo.getCollection(
      config.targetLoader.collectionName || "silver/linkedin.companies",
    );
    await silverColl.updateOne(
      { companyId: id },
      { $set: doc },
      { upsert: true },
    );

    // Mark completed in Redis if needed
    if (redisInstance && config.converter.completedSetKey) {
      await redisInstance.sadd(config.converter.completedSetKey, id);
    }

    return { targetDirName: "linkedin.companies" };
  }
}

if (require.main === module) {
  (async () => {
    const pipeline = new LinkedInCompanyContents();
    try {
      await pipeline.run();
    } catch (err: any) {
      console.error(`❌ Pipeline 실행 실패: ${err.message}`);
      process.exit(1);
    }
  })();
}
