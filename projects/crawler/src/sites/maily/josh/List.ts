/**
 * @module List
 * @description Core functionality or script runner for List.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies cheerio, BaseListService, crypto
 * @lastUpdated 2026-06-11
 */

import * as cheerio from "cheerio";
import { BaseListService } from "../../../core/BaseListService";
import { descriptor } from "./site.config";

class MailyJoshList extends BaseListService {
  constructor() {
    super({
      site: descriptor.key,
      displayName: descriptor.name,
      cacheSetKey:
        descriptor.converter?.completedSetKey || `completed_${descriptor.key}`,
      bronzeHtmlCollection:
        descriptor.scraper?.collectionName ||
        (`bronze/${descriptor.key}.html` as any),
      urlsCollection:
        descriptor.scraper?.urlsCollectionName ||
        (`bronze/${descriptor.key}.urls` as any),
    });
  }

  public async run(pageArg?: number): Promise<number> {
    const sleepSec = parseInt(process.env.LIST_SLACK || "2", 10);
    const pageEnv = process.env.PAGE || "";
    const pageRange = pageEnv.includes("-")
      ? pageEnv.split("-").map(Number)
      : [1, parseInt(pageEnv || "1", 10)];
    const startPage = pageArg || pageRange[0];
    const endPage = pageRange[1] || startPage;

    await this.seedCache();

    let queuedCount = 0;
    const seenUrls = new Set<string>();

    for (let page = startPage; page <= endPage; page++) {
      let fetchUrl = "";
      if (descriptor.scraper?.generateUrls) {
        const urls = descriptor.scraper.generateUrls({ page });
        if (urls.length > 0) {
          fetchUrl = urls[0];
        }
      }
      console.log(`🌐 [MailyJosh List] Fetching page ${page}: ${fetchUrl}`);

      let res: Response | null = null;
      const retries = 3;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          res = await fetch(fetchUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });
          if (res.ok) break;

          console.warn(
            `⚠️ [MailyJosh List] Fetch failed with status ${res.status} (attempt ${attempt}/${retries}). Waiting ${attempt * 5}s before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
        } catch (err: any) {
          console.warn(
            `⚠️ [MailyJosh List] Fetch network error: ${err.message} (attempt ${attempt}/${retries}). Waiting ${attempt * 5}s before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
        }
      }

      if (!res || !res.ok) {
        const statusMsg = res ? `HTTP status ${res.status}` : "Network error";
        console.error(
          `❌ [MailyJosh List] Page ${page} failed (${statusMsg}). Stopping this section.`,
        );
        break;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      const articleLinks = this.extractArticleLinks($, seenUrls);

      if (articleLinks.length === 0) {
        console.log(
          `🏁 [MailyJosh List] No articles found on page ${page}. Done.`,
        );
        break;
      }

      console.log(
        `🔍 [MailyJosh List] Found ${articleLinks.length} new articles on page ${page}.`,
      );

      for (const { url, title } of articleLinks) {
        const crypto = require("crypto");
        const id = crypto.createHash("md5").update(url).digest("hex");
        if (await this.processItem(id, url, title)) {
          queuedCount++;
        }
      }

      if (page < endPage) {
        console.log(`💤 Waiting ${sleepSec}s before next page...`);
        await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
      }
    }

    console.log(
      `🎉 [MailyJosh List] Successfully queued ${queuedCount} items.`,
    );
    return queuedCount;
  }

  private extractArticleLinks(
    $: cheerio.CheerioAPI,
    seenUrls: Set<string>,
  ): Array<{ url: string; title: string }> {
    const results: Array<{ url: string; title: string }> = [];

    $('a.post-card-list-item[href*="/josh/posts/"]').each((_, el) => {
      const href = $(el).attr("href");
      if (!href || seenUrls.has(href)) return;
      seenUrls.add(href);

      const titleEl = $(el).find(".font-bold").first();
      const title = titleEl.text().trim();
      if (title) {
        results.push({ url: href, title });
      }
    });

    return results;
  }
}

if (require.main === module) {
  (async () => {
    const list = new MailyJoshList();
    try {
      await list.init();
      await list.run();
    } catch (e: any) {
      console.error(`❌ List failed: ${e.message}`);
    } finally {
      await list.close();
    }
  })();
}
