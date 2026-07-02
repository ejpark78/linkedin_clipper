/**
 * @module site.config
 * @description Core functionality or script runner for site.config.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies SiteRegistry, Converter, scraper
 * @lastUpdated 2026-06-11
 */

import type { SiteDescriptor } from "../../core/SiteRegistry";
import { YozmConverter } from "./Converter";
import { scrapeHttpFetch } from "../../utils/scraper";

export const SITEMAP_URL = "https://yozm.wishket.com/magazine/sitemap-news.xml";

export interface YozmMeta {
  id: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  category: string | null;
  author: string | null;
  content: string;
  rawContent: string;
}

export const descriptor: SiteDescriptor = {
  key: "yozm",
  name: "요즘IT",
  domain: "yozm.wishket.com",
  favicon: "https://yozm.wishket.com/favicon.ico",
  indexName: "yozm",

  indexes: [
    {
      collection: "bronze/yozm.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/yozm.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "bronze/yozm.urls", fields: { status: 1, id: 1 } },
    {
      collection: "silver/yozm.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "silver/yozm.contents", fields: { publishedAt: -1 } },
    {
      collection: "silver/yozm.contents",
      fields: { title: "text", content: "text", markdown: "text", url: "text" },
      options: {
        weights: { title: 10, content: 5, markdown: 3, url: 1 },
        name: "text_idx",
      },
    },
  ],

  scraper: {
    collectionName: "bronze/yozm.html",
    targetCollection: "yozm.html",
    updateFilterKey: "id",
    defaultSlack: 3,
    extractId: (url) => {
      const match = url.match(/\/detail\/(\d+)\//);
      return match ? match[1] : "";
    },
    excludePatterns: ["favicon", "login", "logout", "signup"],
    urlsCollectionName: "bronze/yozm.urls",
    scrape: scrapeHttpFetch,
  },

  converter: {
    converter: new YozmConverter(),
    targetCollection: "yozm.html",
    filter: (id) => ({ id }),
    statusCollection: "bronze/yozm.urls",
    completedSetKey: "sites:yozm:completed",
  },

  targetLoader: {
    collectionName: "silver/yozm.contents",
    filterField: "id",
    buildDocument: (id, meta: YozmMeta) => ({
      id,
      title: meta.title || "Untitled",
      url: meta.url || null,
      publishedAt: meta.publishedAt || null,
      content: meta.content || null,
      markdown: meta.rawContent || null,
      updatedAt: new Date(),
    }),
  },
};
