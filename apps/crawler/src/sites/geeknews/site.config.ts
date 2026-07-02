/**
 * @module site.config
 * @description Core functionality or script runner for site.config.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies SiteRegistry, Converter, scraper
 * @lastUpdated 2026-06-11
 */

import type { SiteDescriptor } from "../../core/SiteRegistry";
import { GeekNewsConverter } from "./Converter";
import { scrapeHttpFetch } from "../../utils/scraper";

export interface GeekNewsComment {
  commentId: string;
  author: string;
  content: string;
}

export interface GeekNewsMeta {
  id: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  content: string;
  comments: GeekNewsComment[];
  jsonLdRaw: string | null;
  rawContent: string;
}

export const descriptor: SiteDescriptor = {
  key: "geeknews",
  name: "GeekNews",
  domain: "news.hada.io",
  favicon: "https://news.hada.io/favicon.ico",
  indexName: "geeknews",

  indexes: [
    {
      collection: "bronze/geeknews.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/geeknews.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "bronze/geeknews.urls", fields: { status: 1, id: 1 } },
    {
      collection: "silver/geeknews.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "silver/geeknews.contents", fields: { publishedAt: -1 } },
    {
      collection: "silver/geeknews.contents",
      fields: {
        title: "text",
        content: "text",
        markdown: "text",
        url: "text",
        companyName: "text",
      },
      options: {
        weights: { title: 10, content: 5, markdown: 3, url: 1, companyName: 3 },
        name: "text_idx",
      },
    },
  ],

  scraper: {
    collectionName: "bronze/geeknews.html",
    targetCollection: "geeknews.html",
    updateFilterKey: "topicId",
    defaultSlack: 3,
    extractId: (url) => {
      const weeklyMatch = url.match(/\/weekly\/(\d+)$/);
      if (weeklyMatch) {
        return `weekly-${weeklyMatch[1]}`;
      }
      const match = url.match(/[?&]id=(\d+)/);
      return match ? match[1] : "";
    },
    excludePatterns: [
      "vote?",
      "/vote",
      "user?",
      "/user",
      "item?",
      "favicon",
      "login",
      "logout",
      "signup",
    ],
    urlsCollectionName: "bronze/geeknews.urls",
    scrape: scrapeHttpFetch,
    generateUrls: (config: { page?: number }): string[] => {
      const page = config.page || 1;
      const urls: string[] = [];

      if (page === 1) {
        urls.push(
          "https://news.hada.io/",
          "https://news.hada.io/new",
          "https://news.hada.io/weekly/page/1",
          "https://news.hada.io/plus",
          "https://news.hada.io/show",
        );
      } else {
        if (page <= 5) {
          urls.push(`https://news.hada.io/?page=${page}`);
        }
        urls.push(
          `https://news.hada.io/weekly/page/${page}`,
          `https://news.hada.io/plus?page=${page}`,
          `https://news.hada.io/show?page=${page}`,
        );
      }
      return urls;
    },
  },

  converter: {
    converter: new GeekNewsConverter(),
    targetCollection: "geeknews.html",
    filter: (id) => ({ topicId: id }),
    statusCollection: "bronze/geeknews.urls",
    completedSetKey: "sites:geeknews:completed",
  },

  targetLoader: {
    collectionName: "silver/geeknews.contents",
    filterField: "id",
    buildDocument: (id, meta: GeekNewsMeta) => ({
      id,
      title: meta.title || "Untitled",
      url: meta.url || null,
      content: meta.content || null,
      comments: meta.comments || null,
      jsonLdRaw: meta.jsonLdRaw || null,
      markdown: meta.rawContent || null,
      publishedAt: meta.publishedAt || null,
      updatedAt: new Date(),
    }),
  },

  refreshSilver: {
    getSilverFields: (meta: GeekNewsMeta) => ({
      id: meta.id,
      title: meta.title,
      url: meta.url,
      publishedAt: meta.publishedAt,
      content: meta.content,
      comments: meta.comments,
      jsonLdRaw: meta.jsonLdRaw,
      markdown: meta.rawContent,
      updatedAt: new Date(),
    }),
  },
};
