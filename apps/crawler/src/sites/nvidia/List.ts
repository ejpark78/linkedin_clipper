import { BaseListService } from "../../core/BaseListService";
import { descriptor, START_URL } from "./site.config";
import { chromium } from "playwright";
import * as cheerio from "cheerio";

class NvidiaList extends BaseListService {
  constructor() {
    super({
      site: descriptor.key,
      displayName: descriptor.name,
      cacheSetKey: `sites:${descriptor.key}:completed`,
      bronzeHtmlCollection:
        descriptor.scraper?.collectionName ||
        (`bronze/${descriptor.key}.html` as any),
      urlsCollection:
        descriptor.scraper?.urlsCollectionName ||
        (`bronze/${descriptor.key}.urls` as any),
    });
  }

  public async run(pageArg?: number): Promise<number> {
    await this.seedCache();

    let queuedCount = 0;
    const visited = new Set<string>();
    const queue: { url: string; depth: number }[] = [];

    queue.push({ url: START_URL, depth: 0 });
    visited.add(START_URL);

    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;

        const { url, depth } = current;
        if (depth > 100) continue;

        console.log(
          `🔍 [Nvidia List] Crawling depth=${depth}: ${url} (Queue size: ${queue.length})`,
        );

        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          const html = await page.content();
          const $ = cheerio.load(html);

          // URL_FILTER=omniverse 필터 통과한 경우에만 DB 적재 및 스크랩 큐 주입
          const id = descriptor.scraper!.extractId(url);
          if (descriptor.scraper?.urlFilter?.(url)) {
            if (await this.processItem(id, url, `Nvidia Page - ${id}`)) {
              queuedCount++;
            }
          }

          // 다음 depth 탐색을 위한 링크 수집
          const links: string[] = [];
          $("a[href]").each((_, el) => {
            const href = $(el).attr("href");
            if (href) {
              try {
                const resolvedUrl = new URL(href, url).href.split("#")[0]; // fragment 제거
                links.push(resolvedUrl);
              } catch (e) {
                // Invalid URL
              }
            }
          });

          for (const link of links) {
            if (visited.has(link)) continue;

            try {
              const parsed = new URL(link);
              const hostname = parsed.hostname;
              const isNvidiaDomain =
                hostname === "nvidia.com" || hostname.endsWith(".nvidia.com");

              // URL Filter: omniverse가 들어갔는지 검사
              const matchesFilter =
                descriptor.scraper?.urlFilter?.(link) ?? true;

              if (isNvidiaDomain && matchesFilter) {
                visited.add(link);
                queue.push({ url: link, depth: depth + 1 });
              }
            } catch {
              // Domain check exception
            }
          }
        } catch (err: any) {
          console.warn(
            `⚠️ [Nvidia List] Failed to fetch ${url}: ${err.message}`,
          );
        }
      }
    } finally {
      await browser.close();
    }

    console.log(
      `🎉 [Nvidia List] BFS navigation complete. Queued ${queuedCount} items.`,
    );
    return queuedCount;
  }
}

if (require.main === module) {
  (async () => {
    const list = new NvidiaList();
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
