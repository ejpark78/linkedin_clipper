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

export interface GptersMeta {
  id: string;
  title: string;
  url: string;
  author: string | null;
  shortContent: string | null;
  publishedAt: Date | null;
  reactionsCount: number;
  repliesCount: number;
  rawContent: string;
  spaceId: string | null;
  spaceName: string | null;
  spaceSlug: string | null;
}

function buildGptersDocument(
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

export const descriptor: SiteDescriptor = {
  key: "gpters",
  name: "GPTers News",
  domain: "gpters.org",
  favicon: "https://gpters.org/favicon.ico",
  indexName: "gpters",

  indexes: [
    {
      collection: "bronze/gpters.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/gpters.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "bronze/gpters.urls", fields: { status: 1, id: 1 } },
    {
      collection: "silver/gpters.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "silver/gpters.contents", fields: { publishedAt: -1 } },
    {
      collection: "silver/gpters.contents",
      fields: { title: "text", content: "text", markdown: "text", url: "text" },
      options: {
        weights: { title: 10, content: 5, markdown: 3, url: 1 },
        name: "text_idx",
      },
    },
  ],

  scraper: {
    collectionName: "bronze/gpters.html",
    targetCollection: "gpters.html",
    updateFilterKey: "postId",
    defaultSlack: 3,
    extractId: (url) => {
      const parts = url.split("-");
      const id = parts[parts.length - 1] || "";
      return /^[a-zA-Z0-9]{15}$/.test(id) ? id : "";
    },
    excludePatterns: ["favicon", "login", "logout", "signup"],
    urlsCollectionName: "bronze/gpters.urls",
    scrape: scrapeGptersGraphQL,
  },

  converter: {
    get converter() {
      return new GptersConverter();
    },
    targetCollection: "gpters.html",
    filter: (id) => ({ $or: [{ postId: id }, { id: id }] }),
    statusCollection: "bronze/gpters.urls",
    completedSetKey: "sites:gpters:completed",
  },

  targetLoader: {
    collectionName: "silver/gpters.contents",
    filterField: "id",
    buildDocument: (id, meta: GptersMeta) => buildGptersDocument(id, meta),
  },

  refreshSilver: {
    saveJson: true,
    imageDownload: {
      enabled: true,
      htmlSource: "shortContent",
    },
    getSilverFields: (meta: GptersMeta) => ({
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
