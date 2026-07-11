/**
 * @module List
 * @description Core functionality or script runner for List.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies cheerio, mongo, BaseListService, utils
 * @lastUpdated 2026-06-11
 */

import * as cheerio from "cheerio";
import { BaseListService } from "../../core/BaseListService";
import { descriptor } from "./site.config";
import { AppConfig } from "../../config/AppConfig";

class GeekNewsList extends BaseListService {
  private exhaustedSections = new Set<string>();

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

  private getBasePath(urlStr: string): string {
    try {
      const u = new URL(urlStr);
      return u.pathname.startsWith("/weekly") ? "/weekly" : u.pathname;
    } catch {
      return urlStr;
    }
  }

  public async run(page: number = 1): Promise<number> {
    let urls = [
      descriptor.domain
        ? `https://${descriptor.domain}/`
        : "https://news.hada.io/",
    ];
    if (descriptor.scraper?.generateUrls) {
      urls = descriptor.scraper.generateUrls({ page });
    }

    const sleepSec = AppConfig.LIST_SLACK;
    await this.seedCache();

    let queuedCount = 0;

    for (const url of urls) {
      const basePath = this.getBasePath(url);
      if (this.exhaustedSections.has(basePath)) {
        console.log(
          `⏭️ [GeekNews List] Skipping exhausted section URL: ${url}`,
        );
        continue;
      }

      if (sleepSec > 0) {
        console.log(`💤 [대기] GeekNews 목록 수집 전 ${sleepSec}초 대기 중...`);
        await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
      }

      console.log(`🌐 [GeekNews List] Fetching page: ${url}`);
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            console.warn(
              `⚠️ [GeekNews List] Status 404 for ${url}. Marking section ${basePath} as exhausted.`,
            );
            this.exhaustedSections.add(basePath);
          } else {
            console.error(
              `❌ Failed to fetch GeekNews page ${url}. Status: ${response.status}`,
            );
          }
          continue;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        if (url.includes("/weekly")) {
          const issueLinks: string[] = [];
          $('.weekly a[href*="/weekly/"]').each((_, el) => {
            const href = $(el).attr("href");
            if (href && /\/weekly\/\d+$/.test(href)) {
              issueLinks.push(href);
            }
          });

          if (issueLinks.length === 0) {
            console.log(
              `🏁 [GeekNews List] Found 0 weekly issues on archive page: ${url}. Marking section ${basePath} as exhausted.`,
            );
            this.exhaustedSections.add(basePath);
            continue;
          }

          console.log(
            `🔍 [GeekNews List] Found ${issueLinks.length} weekly issues on archive page.`,
          );

          for (const issueLink of issueLinks) {
            const issueUrl = issueLink.startsWith("http")
              ? issueLink
              : `https://${descriptor.domain || "news.hada.io"}/${issueLink.replace(/^\//, "")}`;
            const issueMatch = issueUrl.match(/\/weekly\/(\d+)$/);
            const issueNum = issueMatch ? issueMatch[1] : "";

            if (issueNum) {
              const issueId = `weekly-${issueNum}`;
              const isCompleted = await this.redis.sismember(
                this.config.cacheSetKey,
                issueId,
              );
              if (isCompleted) {
                console.log(
                  `⏭️ [GeekNews List] Skipping already processed weekly issue: ${issueId} (${issueUrl})`,
                );
                continue;
              }
            }

            console.log(
              `🌐 [GeekNews List] Fetching weekly issue: ${issueUrl}`,
            );
            if (sleepSec > 0) {
              await new Promise((resolve) =>
                setTimeout(resolve, sleepSec * 1000),
              );
            }
            try {
              const issueRes = await fetch(issueUrl, {
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                },
              });
              if (!issueRes.ok) continue;
              const issueHtml = await issueRes.text();
              const $issue = cheerio.load(issueHtml);

              if (issueNum) {
                const queuedSelf = await this.processItem(
                  `weekly-${issueNum}`,
                  issueUrl,
                  `GeekNews 주간 소식 (${issueNum})`,
                );
                if (queuedSelf) {
                  queuedCount++;
                  console.log(
                    `➕ [GeekNews List] Queued weekly issue self: ${issueUrl}`,
                  );
                }
              }

              let issueTopicsCount = 0;
              const promises: Promise<void>[] = [];
              // Extract topics from weekly issue page
              $issue('a[href*="topic?id="]').each((_, el) => {
                const title = $issue(el).text().trim();
                const href = $issue(el).attr("href") || "";
                if (!title || !href) return;

                const match = href.match(/id=(\d+)/);
                if (match) {
                  const id = match[1];
                  const detailUrl = href.startsWith("http")
                    ? href
                    : `https://${descriptor.domain || "news.hada.io"}/${href.replace(/^\//, "")}`;

                  promises.push(
                    this.processItem(id, detailUrl, title)
                      .then((queued) => {
                        if (queued) {
                          queuedCount++;
                          issueTopicsCount++;
                        }
                      })
                      .catch(() => {}),
                  );
                }
              });
              await Promise.all(promises);
              console.log(
                `🔍 [GeekNews List] Processed weekly issue ${issueUrl}: queued ${issueTopicsCount} new topics.`,
              );
            } catch (issueErr: any) {
              console.error(
                `❌ Error parsing weekly issue ${issueUrl}: ${issueErr.message}`,
              );
            }
          }
        } else {
          const topicRows = $(".topic_row");
          console.log(
            `🔍 [GeekNews List] Found ${topicRows.length} topics on page: ${url}`,
          );

          if (topicRows.length === 0) {
            console.log(
              `🏁 [GeekNews List] Found 0 topics on page: ${url}. Marking section ${basePath} as exhausted.`,
            );
            this.exhaustedSections.add(basePath);
            continue;
          }

          for (let i = 0; i < topicRows.length; i++) {
            const row = $(topicRows[i]);
            const titleEl = row.find(".topictitle a");
            if (titleEl.length === 0) continue;

            const title = titleEl.text().trim();
            const relativeUrl = titleEl.attr("href") || "";
            if (!relativeUrl) continue;

            let topicUrl = "";
            const commentLinkEl = row.find(
              'a[href^="topic?id="], a[href*="topic?id="]',
            );
            if (commentLinkEl.length > 0) {
              topicUrl = commentLinkEl.first().attr("href") || "";
            } else if (relativeUrl.includes("topic?id=")) {
              topicUrl = relativeUrl;
            }

            if (!topicUrl) continue;

            const detailUrl = `https://${descriptor.domain}/${topicUrl.replace(/^\//, "")}`;

            let id = "";
            const match = topicUrl.match(/id=(\d+)/);
            if (match) {
              id = match[1];
            }

            if (!id) continue;

            if (await this.processItem(id, detailUrl, title)) {
              queuedCount++;
            }
          }
        }
      } catch (err: any) {
        console.error(`❌ Error fetching/processing ${url}: ${err.message}`);
      }
    }

    console.log(`🎉 [GeekNews List] Successfully queued ${queuedCount} items.`);
    return queuedCount;
  }

  public async runBackfill(day: string): Promise<number> {
    let page = 1;
    let totalQueuedCount = 0;
    const sleepSec = AppConfig.LIST_SLACK;
    await this.seedCache();

    while (true) {
      const url = `https://${descriptor.domain || "news.hada.io"}/past?day=${day}&page=${page}`;
      if (sleepSec > 0) {
        console.log(
          `\n💤 [대기] GeekNews 백필 (${day}, page ${page}) 수집 전 ${sleepSec}초 대기 중...`,
        );
        await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
      }

      console.log(`🌐 [GeekNews List Backfill] Fetching page: ${url}`);
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          console.error(
            `❌ Failed to fetch GeekNews page. Status: ${response.status}`,
          );
          break;
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        const topicRows = $(".topic_row");
        console.log(
          `🔍 [GeekNews List Backfill] Found ${topicRows.length} topics on page.`,
        );

        if (topicRows.length === 0) {
          break;
        }

        let queuedCount = 0;
        for (let i = 0; i < topicRows.length; i++) {
          const row = $(topicRows[i]);
          const titleEl = row.find(".topictitle a");
          if (titleEl.length === 0) continue;

          const title = titleEl.text().trim();
          const relativeUrl = titleEl.attr("href") || "";
          if (!relativeUrl) continue;

          let topicUrl = "";
          const commentLinkEl = row.find(
            'a[href^="topic?id="], a[href*="topic?id="]',
          );
          if (commentLinkEl.length > 0) {
            topicUrl = commentLinkEl.first().attr("href") || "";
          } else if (relativeUrl.includes("topic?id=")) {
            topicUrl = relativeUrl;
          }

          if (!topicUrl) continue;

          const detailUrl = `https://${descriptor.domain || "news.hada.io"}/${topicUrl.replace(/^\//, "")}`;

          let id = "";
          const match = topicUrl.match(/id=(\d+)/);
          if (match) {
            id = match[1];
          }

          if (!id) continue;

          if (await this.processItem(id, detailUrl, title)) {
            queuedCount++;
          }
        }

        totalQueuedCount += queuedCount;

        // Check if next page link exists
        const nextPage = page + 1;
        const nextPageEl = $(
          `a[href*='day=${day}'][href*='page=${nextPage}'], a[href*='day=${day}'][href*='page%3D${nextPage}']`,
        );
        if (nextPageEl.length > 0) {
          page = nextPage;
        } else {
          console.log(
            `🏁 [GeekNews List Backfill] No more pages for day ${day} (finished at page ${page}).`,
          );
          break;
        }
      } catch (err: any) {
        console.error(`❌ Backfill page ${page} failed: ${err.message}`);
        break;
      }
    }

    return totalQueuedCount;
  }
}

function getDatesInRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const current = new Date(startStr);
  const end = new Date(endStr);

  if (current <= end) {
    while (current <= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
  } else {
    while (current >= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() - 1);
    }
  }
  return dates;
}

if (require.main === module) {
  (async () => {
    const list = new GeekNewsList();
    try {
      await list.init();
      const arg = process.argv[2] || "1";

      const isDatePattern = /^\d{4}-\d{2}-\d{2}$/;
      const isDateRangePattern = /^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/;

      if (isDatePattern.test(arg) || isDateRangePattern.test(arg)) {
        let days: string[] = [];
        if (arg.includes("~")) {
          const [start, end] = arg.split("~");
          days = getDatesInRange(start.trim(), end.trim());
        } else {
          days = [arg.trim()];
        }

        console.log(
          `🚀 [GeekNews List] Backfill Mode. Days to process: ${days.join(", ")}`,
        );
        for (const day of days) {
          console.log(`\n📅 [GeekNews List] Processing day: ${day}`);
          const count = await list.runBackfill(day);
          console.log(
            `🎉 [GeekNews List] Day ${day} completed. Queued ${count} items.`,
          );
        }
      } else if (arg.includes("-")) {
        const [startStr, endStr] = arg.split("-");
        const start = parseInt(startStr, 10) || 1;
        const end = parseInt(endStr, 10) || start;
        console.log(
          `🚀 [GeekNews List] Normal Mode. Running page range: ${start} to ${end}`,
        );

        for (let p = start; p <= end; p++) {
          console.log(`\n📄 [GeekNews List] Processing page ${p}/${end}...`);
          await list.run(p);
        }
      } else {
        const page = parseInt(arg, 10) || 1;
        await list.run(page);
      }
    } catch (e: any) {
      console.error(`❌ List failed: ${e.message}`);
    } finally {
      await list.close();
    }
  })();
}
