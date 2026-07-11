/**
 * @module site.config
 * @description Core functionality or script runner for site.config.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 *   - Ensures extracted post IDs are strictly alphanumeric Bettermode IDs to prevent malformed queries.
 * @dependencies SiteRegistry, Converter, scrape
 * @lastUpdated 2026-06-11
 */

import type { SiteDescriptor } from "../../../core/SiteRegistry";
import { GptersConverter } from "../Converter";
import { scrapeGptersGraphQL } from "../scrape";
import { GptersMeta } from "../news/site.config";
export { GptersMeta };

function buildGptersNewsletterDocument(
  id: string,
  meta: GptersMeta,
): Record<string, any> {
  const doc: Record<string, any> = {
    id,
    title: meta.title || "Untitled",
    url: meta.url || null,
    author: meta.author || null,
    shortContent: meta.shortContent || null,
    publishedAt: meta.publishedAt || null,
    reactionsCount: meta.reactionsCount || 0,
    repliesCount: meta.repliesCount || 0,
    markdown: meta.rawContent || null,
    updatedAt: new Date(),
  };
  if (meta.spaceId) doc.spaceId = meta.spaceId;
  if (meta.spaceName) doc.spaceName = meta.spaceName;
  if (meta.spaceSlug) doc.spaceSlug = meta.spaceSlug;
  return doc;
}

export const NEWSLETTER_QUERY = `
query GetPosts($after: String, $before: String, $filterBy: [PostListFilterByInput!], $limit: Int!, $orderByString: String, $postTypeIds: [String!], $reverse: Boolean, $spaceIds: [ID!]) {
  posts(after: $after, before: $before, filterBy: $filterBy, limit: $limit, orderByString: $orderByString, postTypeIds: $postTypeIds, reverse: $reverse, spaceIds: $spaceIds) {
    nodes {
      id
      title
      slug
      createdAt
      publishedAt
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

export const NEWSLETTER_VARS = {
  filterBy: [],
  limit: 20,
  orderByString: "publishedAt",
  postTypeIds: ["KLxSodedLeDUiTj"],
  reverse: true,
  spaceIds: ["J9vvyRmbEsRs"],
};

export const descriptor: SiteDescriptor = {
  key: "gpters_newsletter",
  name: "GPTers Newsletter",
  domain: "gpters.org",
  favicon: "https://gpters.org/favicon.ico",
  indexName: "gpters_newsletter",

  indexes: [
    {
      collection: "bronze/gpters_newsletter.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/gpters_newsletter.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/gpters_newsletter.urls",
      fields: { status: 1, id: 1 },
    },
    {
      collection: "silver/gpters_newsletter.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "silver/gpters_newsletter.contents",
      fields: { publishedAt: -1 },
    },
    {
      collection: "silver/gpters_newsletter.contents",
      fields: { title: "text", content: "text", markdown: "text", url: "text" },
      options: {
        weights: { title: 10, content: 5, markdown: 3, url: 1 },
        name: "text_idx",
      },
    },
  ],

  scraper: {
    collectionName: "bronze/gpters_newsletter.html",
    targetCollection: "gpters_newsletter.html",
    updateFilterKey: "id",
    defaultSlack: 3,
    extractId: (url) => {
      const parts = url.split("-");
      const id = parts[parts.length - 1] || "";
      return /^[a-zA-Z0-9]{15}$/.test(id) ? id : "";
    },
    excludePatterns: ["favicon", "login", "logout", "signup"],
    urlsCollectionName: "bronze/gpters_newsletter.urls",
    scrape: scrapeGptersGraphQL,
  },

  converter: {
    get converter() {
      return new GptersConverter();
    },
    targetCollection: "gpters_newsletter.html",
    filter: (id) => ({ id }),
    statusCollection: "bronze/gpters_newsletter.urls",
    completedSetKey: "sites:gpters_newsletter:completed",
  },

  targetLoader: {
    collectionName: "silver/gpters_newsletter.contents",
    filterField: "id",
    buildDocument: buildGptersNewsletterDocument,
  },

  refreshSilver: {
    saveJson: true,
    extractId: (doc: any) => doc.id || doc.postId || "",
    getSilverFields: (meta: any) => ({
      id: meta.id,
      title: meta.title,
      url: meta.url,
      author: meta.author,
      shortContent: meta.shortContent,
      publishedAt: meta.publishedAt,
      reactionsCount: meta.reactionsCount,
      repliesCount: meta.repliesCount,
      markdown: meta.rawContent,
      updatedAt: new Date(),
    }),
  },
};
