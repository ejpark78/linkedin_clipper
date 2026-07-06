/**
 * @module UppityList
 * @description Crawls lists of articles from Uppity categories and extracts detail URLs.
 * @constraints
 *   - Excludes category, tag, author, page, login, logout, and download.cm URLs.
 *   - Uses BaseListService for database storage (bronze/uppity.urls) and Redis queueing.
 * @dependencies cheerio, BaseListService
 * @lastUpdated 2026-06-11
 */

import * as cheerio from "cheerio";
import { BaseListService } from "../../core/BaseListService";
import { descriptor, SECTIONS } from "./site.config";

class UppityList extends BaseListService {
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
    const pageEnv = process.env.PAGE || "1";
    const sleepSec = parseInt(process.env.LIST_SLACK || "2", 10);

    let sectionsToProcess = SECTIONS;
    const sectionFilter = process.env.SECTION;
    if (sectionFilter) {
      sectionsToProcess = SECTIONS.filter((s) => s.slug === sectionFilter);
    }

    await this.seedCache();

    let queuedCount = 0;

    for (const section of sectionsToProcess) {
      const pageRange = pageEnv.includes("-")
        ? pageEnv.split("-").map(Number)
        : [1, parseInt(pageEnv, 10)];

      const startPage = pageArg || pageRange[0];
      const endPage = pageRange[1] || startPage;

      for (let p = startPage; p <= endPage; p++) {
        let fetchUrl = "";
        if (descriptor.scraper?.generateUrls) {
          const urls = descriptor.scraper.generateUrls({
            page: p,
            section: section.slug,
          });
          if (urls.length > 0) {
            fetchUrl = urls[0];
          }
        }

        console.log(
          `🌐 [Uppity List] [${section.name}] Fetching page ${p}: ${fetchUrl}`,
        );

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
              `⚠️ [Uppity List] Fetch failed with status ${res.status} (attempt ${attempt}/${retries}). Waiting ${attempt * 5}s before retry...`,
            );
            await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
          } catch (err: any) {
            console.warn(
              `⚠️ [Uppity List] Fetch network error: ${err.message} (attempt ${attempt}/${retries}). Waiting ${attempt * 5}s before retry...`,
            );
            await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
          }
        }

        if (!res || !res.ok) {
          const statusMsg = res ? `HTTP status ${res.status}` : "Network error";
          console.error(
            `❌ [Uppity List] Page ${p} for ${section.name} failed (${statusMsg}). Stopping this section.`,
          );
          break;
        }

        const html = await res.text();
        const $ = cheerio.load(html);

        const links = this.extractArticleLinks($);

        if (links.length === 0) {
          console.log(
            `🏁 [Uppity List] No articles found on page ${p} of ${section.name}.`,
          );
          break;
        }

        console.log(
          `🔍 [Uppity List] Found ${links.length} articles on page ${p} of ${section.name}.`,
        );

        for (const { url: articleUrl, title } of links) {
          let normalizedUrl = articleUrl;
          try {
            normalizedUrl = decodeURIComponent(articleUrl);
          } catch {}
          const id = descriptor.scraper?.extractId
            ? descriptor.scraper.extractId(normalizedUrl)
            : require("crypto")
                .createHash("md5")
                .update(normalizedUrl)
                .digest("hex");
          if (await this.processItem(id, normalizedUrl, title)) {
            queuedCount++;
          }
        }

        if (p < endPage) {
          console.log(`💤 Waiting ${sleepSec}s before next page...`);
          await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
        }
      }
    }

    console.log(`🎉 [Uppity List] Successfully queued ${queuedCount} items.`);
    return queuedCount;
  }

  private extractArticleLinks(
    $: cheerio.CheerioAPI,
  ): Array<{ url: string; title: string }> {
    const results: Array<{ url: string; title: string }> = [];
    const seen = new Set<string>();

    const selectors = [
      ".uc_post_title a",
      ".ue_p_title a",
      ".ue_post_grid h2 a",
      ".ue_post_grid h3 a",
      ".ue_post_grid h4 a",
      ".uc_post_grid_style_one_wrap h2 a",
      ".uc_post_grid_style_one_wrap h3 a",
      ".uc_post_grid_style_one_wrap h4 a",
      "h2 a",
      "h3 a",
      "h4 a",
      ".post-title a",
      ".entry-title a",
    ];

    const container =
      $("main#content, .elementor-location-archive").length > 0
        ? $("main#content, .elementor-location-archive")
        : $("body");

    for (const sel of selectors) {
      container.find(sel).each((_, el) => {
        let href = $(el).attr("href");
        const title = $(el).text().trim();
        if (href && title) {
          // Standardize URL to absolute
          if (href.startsWith("/")) {
            href = `https://${descriptor.domain}${href}`;
          } else if (href.startsWith("http://")) {
            href = href.replace("http://", "https://");
          }

          if (
            href.startsWith(`https://${descriptor.domain}/`) &&
            !seen.has(href)
          ) {
            const isValid = descriptor.scraper?.urlFilter
              ? descriptor.scraper.urlFilter(href)
              : !href.includes("?") && !href.includes("/page/");

            if (isValid) {
              seen.add(href);
              results.push({ url: href, title });
            }
          }
        }
      });
      if (results.length > 0) break;
    }

    return results;
  }
}

if (require.main === module) {
  (async () => {
    const list = new UppityList();
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
