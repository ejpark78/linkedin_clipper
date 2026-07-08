/**
 * @module List
 * @description Core functionality or script runner for List.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies mongo, BaseListService
 * @lastUpdated 2026-06-11
 */

import { BaseListService } from "../../../core/BaseListService";
import { descriptor } from "./site.config";

class GptersList extends BaseListService {
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

  private async fetchGuestToken(): Promise<string> {
    const res = await fetch(`https://www.${descriptor.domain}/news`);
    const html = await res.text();
    const match = html.match(/accessToken":"([^"]+)"/);
    if (!match) {
      throw new Error(
        "Failed to extract GPTERS guest access token from homepage",
      );
    }
    return match[1];
  }

  public async run(limit: number = 20): Promise<number> {
    const pageEnv = process.env.PAGE || "0";
    const maxPages = parseInt(pageEnv, 10) || 0;
    const slackSec = parseInt(process.env.LIST_SLACK || "3", 10);
    console.log(`🌐 [GPTERS List] Fetching guest access token...`);
    const token = await this.fetchGuestToken();

    const query = `
        query getNewsFeed($limit: Int!, $after: String) {
          posts(limit: $limit, after: $after) {
            nodes {
              id
              title
              slug
              createdAt
              createdBy { member { name } }
              reactionsCount
              repliesCount
              shortContent
              fields { key value }
              space { id name slug }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
        `;

    await this.seedCache();

    let queuedCount = 0;
    let after: string | null = null;
    let page = 0;
    let hasNextPage = true;

    let r: Response;
    let resJson: any;
    let posts: any[];
    let pageInfo: any;

    do {
      page++;
      console.log(
        `📄 [GPTERS List] Fetching page ${page}${maxPages > 0 ? "/" + maxPages : ""}...`,
      );

      r = await fetch("https://api.bettermode.com/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          operationName: "getNewsFeed",
          query,
          variables: { limit, after },
        }),
      });

      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(
          `Failed to fetch GPTERS index via GraphQL. Status: ${r.status}: ${body.slice(0, 200)}`,
        );
      }

      resJson = await r.json();
      const postData = resJson.data?.posts;
      posts = postData?.nodes || [];
      pageInfo = postData?.pageInfo || {};
      hasNextPage = pageInfo.hasNextPage || false;
      console.log(
        `🔍 [GPTERS List] Page ${page}: ${posts.length} posts (hasNextPage: ${hasNextPage})`,
      );

      if (posts.length === 0) {
        console.log(`📭 [GPTERS List] No more posts, stopping early.`);
        break;
      }

      for (const post of posts) {
        const id = post.id;
        const slug = post.slug;
        const title = post.title;

        if (!id || !slug) continue;

        const detailUrl = `https://www.${descriptor.domain}/news/post/${slug}-${id}`;

        if (await this.processItem(id, detailUrl, title)) {
          queuedCount++;
        }
      }

      after = pageInfo.endCursor || null;
      if (queuedCount > 0) {
        console.log(
          `⏳ [GPTERS List] ${queuedCount} queued so far (page ${page})`,
        );
      }

      if (hasNextPage && (maxPages === 0 || page < maxPages) && slackSec > 0) {
        console.log(
          `💤 [GPTERS List] ${slackSec}초 대기 후 다음 페이지 요청...`,
        );
        await new Promise((resolve) => setTimeout(resolve, slackSec * 1000));
      }
    } while (hasNextPage && (maxPages === 0 || page < maxPages));

    console.log(
      `🎉 [GPTERS List] Done. Queried ${page} page(s), queued ${queuedCount} items.`,
    );
    return queuedCount;
  }
}

if (require.main === module) {
  (async () => {
    const list = new GptersList();
    try {
      await list.init();
      const limit = process.argv[2] ? parseInt(process.argv[2]) : 20;
      await list.run(limit);
    } catch (e: any) {
      console.error(`❌ List failed: ${e.message}`);
    } finally {
      await list.close();
    }
  })();
}
