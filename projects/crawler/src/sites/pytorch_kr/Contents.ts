/**
 * @module Contents
 * @description Core functionality or script runner for Contents.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path, BasePipeline, Converter, pool
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import { BasePipeline } from "../../core/BasePipeline";
import { PyTorchKRConverter } from "./Converter";
import { BrowserPool } from "../../tools/browser/pool";
import { descriptor, PyTorchKRMeta } from "./site.config";

export class PyTorchKRContents extends BasePipeline<PyTorchKRMeta> {
  private readonly converter: PyTorchKRConverter;

  constructor() {
    super();
    this.converter = new PyTorchKRConverter();
  }

  protected extractId(url: string): string {
    // e.g. https://discuss.pytorch.kr/t/slug-name/1234 -> 1234
    // Extract the last numeric segment from URL path
    const match = url.match(/\/(\d+)(?:\?|$)/);
    if (match) {
      return match[1];
    }
    const crypto = require("crypto");
    return crypto.createHash("md5").update(url).digest("hex").substring(0, 10);
  }

  protected getDomainName(): string {
    return descriptor.domain || "discuss.pytorch.kr";
  }

  protected async executeScrape(
    url: string,
    tempHtmlPath: string,
  ): Promise<void> {
    console.log(
      `🌐 [PyTorch KR Fetch] Loading page with Playwright: ${url} ...`,
    );
    const browser = await BrowserPool.getInstance().getBrowser();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Wait for Discourse post content to render (Onebox transformations + lazy images)
      await page.waitForSelector(".cooked", { timeout: 15000 });
      await new Promise((r) => setTimeout(r, 2000));

      const result = await page.evaluate(() => {
        const cooked = document.querySelector(".cooked");
        const ogTitle = document.querySelector('meta[property="og:title"]');
        const ogTime = document.querySelector(
          'meta[property="article:published_time"]',
        );
        const topicTitle = document.querySelector("h1");
        let title = "";
        if (topicTitle) {
          title = topicTitle.textContent?.trim() || "";
        } else if (ogTitle) {
          title = ogTitle.getAttribute("content") || "";
        } else {
          title = document.title.replace(/\s*-\s*[^-]*$/, "").trim();
        }
        return {
          cookedHtml: cooked ? cooked.innerHTML : "",
          title,
          createdAt: ogTime ? ogTime.getAttribute("content") || "" : "",
        };
      });

      if (!result.cookedHtml) {
        throw new Error(`No cooked content found on page for ${url}`);
      }

      const html = `<!DOCTYPE html>
<html>
<head><title>${result.title.replace(/</g, "&lt;")} - PyTorchKR</title>
<link rel="canonical" href="${url}">
<meta property="article:published_time" content="${result.createdAt}">
</head>
<body>
<div class="post" itemprop="text">${result.cookedHtml}</div>
</body>
</html>`;

      fs.writeFileSync(tempHtmlPath, html, "utf-8");
    } finally {
      await page.close();
      await context.close();
    }
  }

  protected async processMetadata(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<PyTorchKRMeta> {
    return this.converter.convertHtmlToMarkdown(htmlContent, id, url);
  }

  private getDatePathParts(publishedAt: Date | string | null): {
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
    meta: PyTorchKRMeta,
    id: string,
    tempHtmlPath: string,
    _redisInstance?: any,
  ): Promise<{ targetDirName: string }> {
    const { year, month } = this.getDatePathParts(meta.publishedAt);
    const rawHtml = fs.readFileSync(tempHtmlPath, "utf-8");

    // Download images from rawHtml and replace URLs in markdown
    const updatedMarkdown = meta.rawContent;
    try {
      const { downloadImages } = await import("../../utils/imageDownloader");
      const { updatedMarkdown: newMarkdown } = await downloadImages({
        htmlContent: rawHtml,
        markdown: meta.rawContent,
        publishedAt: meta.publishedAt
          ? meta.publishedAt instanceof Date
            ? meta.publishedAt.toISOString()
            : String(meta.publishedAt)
          : undefined,
        docId: id,
        siteDir: descriptor.key,
        siteDomain: descriptor.domain || "discuss.pytorch.kr",
        refererUrl: meta.url,
        removeFavicons: true,
      });
      meta.rawContent = newMarkdown;
    } catch (imgErr: any) {
      console.warn(`⚠️ [PyTorch KR Image Processing] Error: ${imgErr.message}`);
    }

    try {
      const { MongoDatabase } = require("../../database/mongo");
      const dbInstance = MongoDatabase.getInstance();

      // 1. Bronze Layer (Raw HTML) 저장
      const bronzePytorch = await dbInstance.getCollection(
        descriptor.scraper?.collectionName || "bronze/pytorch_kr.html",
      );
      await bronzePytorch.updateOne(
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
      const silverPytorch = await dbInstance.getCollection(
        descriptor.targetLoader?.collectionName || "silver/pytorch_kr.contents",
      );
      await silverPytorch.updateOne(
        { id: id },
        {
          $set: {
            id: id,
            title: meta.title,
            url: meta.url,
            publishedAt: meta.publishedAt,
            content: meta.content,
            markdown: meta.rawContent,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      // 3. Update status in bronze.pytorch_kr_urls
      const pytorchUrlsColl = await dbInstance.getCollection(
        descriptor.scraper?.urlsCollectionName || "bronze/pytorch_kr.urls",
      );
      await pytorchUrlsColl.updateOne(
        { id },
        { $set: { status: "completed", updatedAt: new Date() } },
      );

      console.log(
        `📡 [MongoDB Write] Successfully saved PyTorch KR ID ${id} and marked url as completed.`,
      );

      // 4. Local File System Backup
      const projectRoot = path.resolve(__dirname, "..", "..", "..");
      const baseDir = path.join(
        projectRoot,
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

      // Save Markdown
      await this.converter.prettifyAndSave(meta.rawContent, mdPath);
      console.log(
        `💾 [Local Write] Saved PyTorch KR ID ${id} locally to html/ and markdown/`,
      );
    } catch (dbErr: any) {
      console.error(
        `❌ [PyTorch KR Save Error] Failed to save PyTorch KR ${id}: ${dbErr.message}`,
      );
      throw dbErr;
    } finally {
      if (fs.existsSync(tempHtmlPath)) {
        fs.unlinkSync(tempHtmlPath);
      }
    }

    return {
      targetDirName: "pytorch_kr",
    };
  }
}

if (require.main === module) {
  const urlsFile = process.argv[2];
  const contents = new PyTorchKRContents();
  contents.run(urlsFile).catch((err) => {
    console.error("Fatal PyTorch KR contents crash:", err);
    process.exit(1);
  });
}
