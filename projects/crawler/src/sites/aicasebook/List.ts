/**
 * @module List
 * @description Core functionality or script runner for List.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies playwright, mongo, BaseListService
 * @lastUpdated 2026-06-11
 */

import { chromium } from "playwright";
import { BaseListService } from "../../core/BaseListService";
import { descriptor } from "./site.config";
import { AppConfig } from "../../config/AppConfig";

class AiCasebookList extends BaseListService {
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

  public async run(): Promise<number> {
    const sleepSec = AppConfig.LIST_SLACK;
    if (sleepSec > 0) {
      console.log(`💤 [AiCasebook List] 스크래핑 전 ${sleepSec}초 대기 중...`);
      await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
    }

    console.log(`🌐 [AiCasebook List] Launching browser for main page...`);
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
      await page.goto(`https://${descriptor.domain}/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForSelector('a[href^="/setup/"]', { timeout: 10000 });

      const items = await page.$$eval('a[href^="/setup/"]', (els) => {
        const seen = new Set<string>();
        return els
          .map((el) => {
            const anchor = el as any;
            const href = anchor.href;
            const match = href.match(/\/setup\/(\d+)/);
            if (!match) return null;
            const id = match[1];
            if (seen.has(id)) return null;
            seen.add(id);
            return { id, url: href };
          })
          .filter(Boolean) as { id: string; url: string }[];
      });

      console.log(
        `🔍 [AiCasebook List] Found ${items.length} unique articles on main page.`,
      );

      await this.seedCache();

      let queuedCount = 0;

      for (const item of items) {
        const { id, url } = item;

        if (await this.processItem(id, url, "")) {
          queuedCount++;
        }
      }

      console.log(
        `🎉 [AiCasebook List] Successfully queued ${queuedCount} items.`,
      );
      return queuedCount;
    } finally {
      await browser.close();
    }
  }
}

if (require.main === module) {
  (async () => {
    const list = new AiCasebookList();
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
