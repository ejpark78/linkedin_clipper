/**
 * @module List
 * @description Core functionality or script runner for List.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies cheerio, mongo, BaseListService
 * @lastUpdated 2026-06-11
 */

import * as cheerio from "cheerio";
import { BaseListService } from "../../core/BaseListService";
import { descriptor } from "./site.config";
import { DateUtils } from "../../utils/DateUtils";

class DailyDoseDSList extends BaseListService {
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

  public async run(maxPages: number = 1): Promise<number> {
    const pageStr = process.env.PAGE || "1";
    let maxPage = 1;
    if (pageStr.includes("-")) {
      const [start, end] = pageStr.split("-").map(Number);
      maxPage = end;
    } else {
      maxPage = parseInt(pageStr, 10);
    }
    const sleepSec = parseInt(process.env.LIST_SLACK || "3", 10);

    await this.seedCache();

    let queuedCount = 0;

    // Seed configured seedUrls
    if (descriptor.seedUrls && descriptor.seedUrls.length > 0) {
      console.log(
        `🌱 [Daily Dose DS List] Processing ${descriptor.seedUrls.length} configured seed URLs...`,
      );
      for (const url of descriptor.seedUrls) {
        const id = descriptor.scraper?.extractId
          ? descriptor.scraper.extractId(url)
          : Buffer.from(url)
              .toString("base64")
              .replace(/[^a-zA-Z0-9]/g, "");
        if (!id) continue;
        const title = url.split("/").filter(Boolean).pop() || "Seed URL";
        if (await this.processItem(id, url, title)) {
          queuedCount++;
        }
      }
    }

    for (let p = 1; p <= maxPage; p++) {
      let fetchUrl = "";
      if (descriptor.scraper?.generateUrls) {
        const urls = descriptor.scraper.generateUrls({ page: p });
        if (urls.length > 0) {
          fetchUrl = urls[0];
        }
      }
      console.log(`🌐 [Daily Dose DS List] Fetching page ${p}: ${fetchUrl}`);

      let res: Response | null = null;
      const retries = 3;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          res = await fetch(fetchUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            },
          });
          if (res.ok) break;

          console.warn(
            `⚠️ [Daily Dose DS List] Fetch failed with status ${res.status} (attempt ${attempt}/${retries}). Waiting ${attempt * 5}s before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
        } catch (err: any) {
          console.warn(
            `⚠️ [Daily Dose DS List] Fetch network error: ${err.message} (attempt ${attempt}/${retries}). Waiting ${attempt * 5}s before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
        }
      }

      if (!res || !res.ok) {
        const statusMsg = res ? `HTTP status ${res.status}` : "Network error";
        console.error(
          `❌ [Daily Dose DS List] Page ${p} failed (${statusMsg}). Stopping this section.`,
        );
        break;
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      const articles = $("article").toArray();

      if (articles.length === 0) {
        console.log(
          `🏁 [Daily Dose DS List] No more articles found on page ${p}.`,
        );
        break;
      }

      console.log(
        `🔍 [Daily Dose DS List] Found ${articles.length} articles on page ${p}.`,
      );

      for (const art of articles) {
        const $art = $(art);
        const linkEl = $art.find("a").first();
        const url = linkEl.attr("href");
        const title = $art.find("h2").first().text().trim();
        const dateStr = $art.find("time").first().attr("datetime");

        if (!url || !title) continue;

        const id = Buffer.from(url)
          .toString("base64")
          .replace(/[^a-zA-Z0-9]/g, "");

        if (
          await this.processItem(id, url, title, {
            publishedAt: DateUtils.parseSafeDate(dateStr),
          })
        ) {
          queuedCount++;
        }
      }

      if (p < maxPage) {
        await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
      }
    }

    console.log(
      `🎉 [Daily Dose DS List] Successfully queued ${queuedCount} items.`,
    );
    return queuedCount;
  }
}

if (require.main === module) {
  (async () => {
    const list = new DailyDoseDSList();
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
