/**
 * @module Contents
 * @description Core functionality or script runner for Contents.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path, BasePipeline, Converter, utils
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import { BasePipeline } from "../../core/BasePipeline";
import { GeekNewsConverter } from "./Converter";
import { HtmlMinifier } from "../../utils";
import { descriptor, GeekNewsMeta } from "./site.config";

export class GeekNewsContents extends BasePipeline<GeekNewsMeta> {
  private readonly converter: GeekNewsConverter;

  constructor() {
    super();
    this.converter = new GeekNewsConverter();
  }

  protected extractId(url: string): string {
    // e.g. https://news.hada.io/topic?id=32402 -> 32402
    if (url.includes("id=")) {
      const rawId = url.split("id=").pop()!.split("&")[0];
      const numMatch = rawId.match(/^\d+/);
      return numMatch ? numMatch[0] : rawId;
    }
    // fallback to MD5 hash if not standard ID url
    const crypto = require("crypto");
    return crypto.createHash("md5").update(url).digest("hex").substring(0, 10);
  }

  protected getDomainName(): string {
    return descriptor.domain || "news.hada.io";
  }

  protected async executeScrape(
    url: string,
    tempHtmlPath: string,
  ): Promise<void> {
    console.log(`🌐 [GeekNews Fetch] Fetching ${url} ...`);
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch GeekNews topic details. Status: ${response.status}`,
      );
    }
    const html = await response.text();
    const minifiedHtml = await HtmlMinifier.minify(html, {
      preserveJsonLd: true,
    });
    fs.writeFileSync(tempHtmlPath, minifiedHtml, "utf-8");
  }

  protected async processMetadata(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<GeekNewsMeta> {
    return this.converter.convertHtmlToMarkdown(htmlContent, id, url);
  }

  private getDatePathParts(publishedAt: string | null): {
    year: string;
    month: string;
  } {
    if (publishedAt) {
      const d = new Date(publishedAt);
      if (!isNaN(d.getTime())) {
        return {
          year: d.getFullYear().toString(),
          month: String(d.getMonth() + 1).padStart(2, "0"),
        };
      }
    }
    return { year: "unknown", month: "unknown" };
  }

  protected async saveResults(
    meta: GeekNewsMeta,
    id: string,
    tempHtmlPath: string,
    _redisInstance?: any,
  ): Promise<{ targetDirName: string }> {
    const { year, month } = this.getDatePathParts(
      meta.publishedAt ? meta.publishedAt.toISOString() : null,
    );
    const rawHtml = fs.readFileSync(tempHtmlPath, "utf-8");

    // Download images locally
    try {
      const { downloadImages } = await import("../../utils/imageDownloader");
      const { updatedMarkdown } = await downloadImages({
        htmlContent: rawHtml,
        markdown: meta.rawContent,
        publishedAt: meta.publishedAt
          ? meta.publishedAt.toISOString()
          : undefined,
        docId: id,
        siteDir: "geeknews",
        siteDomain: "news.hada.io",
        refererUrl: meta.url,
        removeFavicons: true,
      });
      meta.rawContent = updatedMarkdown;
    } catch (imgErr: any) {
      console.warn(`⚠️ [GeekNews Image Processing] Error: ${imgErr.message}`);
    }

    // ⚡ [MongoDB 적재] ⚡
    try {
      const { MongoDatabase } = require("../../database/mongo");
      const dbInstance = MongoDatabase.getInstance();

      // 1. Bronze Layer (Raw HTML) 저장
      const bronzeGeeknews = await dbInstance.getCollection(
        descriptor.scraper?.collectionName || "bronze/geeknews.html",
      );
      await bronzeGeeknews.updateOne(
        { id: id },
        {
          $set: {
            id: id,
            url: meta.url,
            rawHtml: rawHtml,
            collectedAt: new Date(),
          },
        },
        { upsert: true },
      );

      // 2. Silver Layer (Cleansed Metadata & Markdown) 저장
      const silverGeeknews = await dbInstance.getCollection(
        descriptor.targetLoader?.collectionName || "silver/geeknews",
      );
      await silverGeeknews.updateOne(
        { id: id },
        {
          $set: {
            id: id,
            title: meta.title,
            url: meta.url,
            publishedAt: meta.publishedAt,
            content: meta.content,
            comments: meta.comments,
            jsonLdRaw: meta.jsonLdRaw,
            markdown: meta.rawContent,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      // 3. Update status in bronze.geeknews_urls
      const geeknewsUrlsColl = await dbInstance.getCollection(
        descriptor.scraper?.urlsCollectionName || "bronze/geeknews.urls",
      );
      await geeknewsUrlsColl.updateOne(
        { id },
        { $set: { status: "completed", updatedAt: new Date() } },
      );

      console.log(
        `📡 [MongoDB Write] Successfully saved GeekNews ID ${id} and marked url as completed.`,
      );

      // 4. Local File System Backup
      const baseDir = path.join(
        __dirname,
        "..",
        "..",
        "data",
        "sites",
        descriptor.key,
        year,
        month,
      );
      const htmlPath = path.join(baseDir, "html", `${id}.html`);
      const mdPath = path.join(baseDir, "markdown", `${id}.md`);

      // Ensure directories exist
      fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
      fs.mkdirSync(path.dirname(mdPath), { recursive: true });

      // Save HTML
      fs.writeFileSync(htmlPath, rawHtml, "utf-8");

      // Prettify & Save Markdown
      await this.converter.prettifyAndSave(meta.rawContent, mdPath);
      console.log(
        `💾 [Local Write] Saved GeekNews ID ${id} locally to html/ and markdown/`,
      );
    } catch (dbErr: any) {
      console.error(
        `❌ [GeekNews Save Error] Failed to save GeekNews ${id}: ${dbErr.message}`,
      );
      throw dbErr;
    } finally {
      if (fs.existsSync(tempHtmlPath)) {
        fs.unlinkSync(tempHtmlPath);
      }
    }

    return {
      targetDirName: "geeknews",
    };
  }
}

if (require.main === module) {
  const urlsFile = process.argv[2];
  const contents = new GeekNewsContents();
  contents.run(urlsFile).catch((err) => {
    console.error("Fatal GeekNews contents pipeline crash:", err);
    process.exit(1);
  });
}
