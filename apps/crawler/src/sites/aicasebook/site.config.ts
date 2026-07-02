/**
 * @module site.config
 * @description Core functionality or script runner for site.config.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies SiteRegistry, Converter, scraper
 * @lastUpdated 2026-06-11
 */

import type { SiteDescriptor } from "../../core/SiteRegistry";
import { AiCasebookConverter } from "./Converter";
import { scrapeHttpFetch } from "../../utils/scraper";

export interface AiCasebookMeta {
  id: string;
  title: string;
  url: string;
  summary: string;
  body: string;
  author: string;
  categories: string[];
  tags: string[];
  publishedAt: Date | null;
  views: number;
  sourceLink: string;
  seriesName: string | null;
  rawContent: string;
}

export const descriptor: SiteDescriptor = {
  key: "aicasebook",
  name: "AI Casebook",
  domain: "aicasebook.dev",
  favicon: "https://aicasebook.dev/favicon.ico",
  indexName: "aicasebook",

  indexes: [
    {
      collection: "bronze/aicasebook.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/aicasebook.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "bronze/aicasebook.urls", fields: { status: 1, id: 1 } },
    {
      collection: "silver/aicasebook.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "silver/aicasebook.contents", fields: { publishedAt: -1 } },
    {
      collection: "silver/aicasebook.contents",
      fields: {
        title: "text",
        summary: "text",
        body: "text",
        markdown: "text",
        tags: "text",
      },
      options: {
        weights: { title: 10, summary: 5, body: 3, markdown: 2, tags: 8 },
        name: "text_idx",
      },
    },
  ],

  scraper: {
    collectionName: "bronze/aicasebook.html",
    targetCollection: "aicasebook.html",
    updateFilterKey: "id",
    defaultSlack: 3,
    extractId: (url) => {
      const match = url.match(/\/setup\/(\d+)/);
      return match ? match[1] : "";
    },
    excludePatterns: ["favicon", "login", "logout", "signup"],
    urlsCollectionName: "bronze/aicasebook.urls",
    scrape: scrapeHttpFetch,
  },

  converter: {
    converter: new AiCasebookConverter(),
    targetCollection: "aicasebook.html",
    filter: (id) => ({ id }),
    statusCollection: "bronze/aicasebook.urls",
    completedSetKey: "sites:aicasebook:completed",
  },

  targetLoader: {
    collectionName: "silver/aicasebook.contents",
    filterField: "id",
    buildDocument: (id, meta: AiCasebookMeta) => ({
      id,
      title: meta.title || "Untitled",
      url: meta.url || null,
      summary: meta.summary || null,
      author: meta.author || null,
      categories: meta.categories || [],
      tags: meta.tags || [],
      publishedAt: meta.publishedAt || null,
      views: meta.views || 0,
      sourceLink: meta.sourceLink || null,
      seriesName: meta.seriesName || null,
      body: meta.body || null,
      markdown: meta.rawContent || null,
      updatedAt: new Date(),
    }),
  },
};
