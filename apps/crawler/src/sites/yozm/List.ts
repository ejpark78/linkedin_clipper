/**
 * @module List
 * @description Core functionality or script runner for List.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies BaseListService
 * @lastUpdated 2026-06-11
 */

import { BaseListService } from "../../core/BaseListService";
import { descriptor, SITEMAP_URL } from "./site.config";

class YozmList extends BaseListService {
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
    await this.seedCache();

    let queuedCount = 0;
    const seenUrls = new Set<string>();

    console.log(`🌐 [Yozm List] Fetching sitemap: ${SITEMAP_URL}`);

    let res: Response | null = null;
    const retries = 3;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        res = await fetch(SITEMAP_URL, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        if (res.ok) break;

        console.warn(
          `⚠️ [Yozm List] Sitemap fetch failed with status ${res.status} (attempt ${attempt}/${retries}). Waiting ${attempt * 5}s before retry...`,
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
      } catch (err: any) {
        console.warn(
          `⚠️ [Yozm List] Sitemap fetch network error: ${err.message} (attempt ${attempt}/${retries}). Waiting ${attempt * 5}s before retry...`,
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
      }
    }

    if (!res || !res.ok) {
      const statusMsg = res ? `HTTP status ${res.status}` : "Network error";
      console.error(
        `❌ [Yozm List] Sitemap fetch failed (${statusMsg}). Stopping.`,
      );
      return 0;
    }

    const xml = await res.text();

    const domain = descriptor.domain || "yozm.wishket.com";
    const escapedDomain = domain.replace(/\./g, "\\.");
    const urlRegex = new RegExp(
      `<loc>(https:\\/\\/${escapedDomain}\\/magazine\\/detail\\/(\\d+)\\/)<\\/loc>`,
      "g",
    );
    let match: RegExpExecArray | null;
    let totalUrls = 0;

    while ((match = urlRegex.exec(xml)) !== null) {
      totalUrls++;
      const url = match[1];
      const id = match[2];

      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      if (await this.processItem(id, url, `Article #${id}`)) {
        queuedCount++;
      }
    }

    console.log(
      `🔍 [Yozm List] Found ${totalUrls} total URLs in sitemap, queued ${queuedCount} new.`,
    );
    console.log(`🎉 [Yozm List] Successfully queued ${queuedCount} items.`);
    return queuedCount;
  }
}

if (require.main === module) {
  (async () => {
    const list = new YozmList();
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
