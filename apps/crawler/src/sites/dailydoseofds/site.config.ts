/**
 * @module DailyDoseDSConfig
 * @description SiteDescriptor configuration for Daily Dose of DS blog.
 * @constraints
 *   - Matches domains dailydoseofds.com.
 *   - Extracts base64 encoded IDs from URLs.
 *   - Excludes binary files, subdomains, non-existent directories, and malformed relative paths.
 * @dependencies DailyDoseDSConverter, scrapeHttpFetch
 * @lastUpdated 2026-06-11
 */

import type { SiteDescriptor } from "../../core/SiteRegistry";
import { DailyDoseDSConverter } from "./Converter";
import { scrapeHttpFetch } from "../../utils/scraper";

export interface DailyDoseDSMeta {
  id: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  content: string;
  rawContent: string;
  discoveredUrls: string[];
}

export const descriptor: SiteDescriptor = {
  key: "dailydose_ds",
  name: "Daily Dose of DS",
  domain: "dailydoseofds.com",
  favicon: "https://www.dailydoseofds.com/favicon.ico",
  indexName: "dailydose_ds",

  indexes: [
    {
      collection: "bronze/dailydose_ds.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/dailydose_ds.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "bronze/dailydose_ds.urls", fields: { status: 1, id: 1 } },
    {
      collection: "silver/dailydose_ds.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "silver/dailydose_ds.contents", fields: { publishedAt: -1 } },
    {
      collection: "silver/dailydose_ds.contents",
      fields: { title: "text", content: "text", markdown: "text", url: "text" },
      options: {
        weights: { title: 10, content: 5, markdown: 3, url: 1 },
        name: "text_idx",
      },
    },
  ],

  seedUrls: [
    "https://www.dailydoseofds.com/mlops-crash-course-part-1/",
    "https://www.dailydoseofds.com/rl-course-part-1/",
    "https://www.dailydoseofds.com/ai-agents-crash-course-part-1-with-implementation/",
    "https://www.dailydoseofds.com/model-context-protocol-crash-course-part-1/",
    "https://www.dailydoseofds.com/a-crash-course-on-building-rag-systems-part-1-with-implementations/",
    "https://www.dailydoseofds.com/bi-encoders-and-cross-encoders-for-sentence-pair-similarity-scoring-part-1/",
    "https://www.dailydoseofds.com/where-did-the-assumptions-of-linear-regression-originate-from/",
    "https://www.dailydoseofds.com/1-fatal-yet-non-obvious-pitfalls-and-cautionary-measures-in-data-science/",
  ],

  scraper: {
    collectionName: "bronze/dailydose_ds.html",
    targetCollection: "dailydose_ds.html",
    updateFilterKey: "id",
    defaultSlack: 3,
    excludePatterns: [
      "billing.",
      ".zip",
      "/content/files/",
      "NousResearch",
      "/blogs/",
      "/docs/",
      "sitemap",
      "/signup/",
      "/passwordReset/",
      "dailydoseofds.com/dailydoseofds.com",
      "dailydoseofds.com/a-crash-course-on-building-rag-systems",
      "favicon",
      "login",
      "logout",
      "signup",
    ],
    extractId: (url) => {
      let normalized = url.trim();
      try {
        normalized = decodeURIComponent(url);
      } catch {}
      try {
        const parsed = new URL(normalized);
        parsed.protocol = "https:";
        if (parsed.hostname.startsWith("www.")) {
          parsed.hostname = parsed.hostname.substring(4);
        }
        parsed.pathname = parsed.pathname.replace(/\/$/, "");
        normalized = parsed.toString();
      } catch {}
      return Buffer.from(normalized)
        .toString("base64")
        .replace(/[^a-zA-Z0-9]/g, "");
    },
    urlsCollectionName: "bronze/dailydose_ds.urls",
    scrape: async (url, tempPath) => {
      let normalizedUrl = url;
      if (url.includes("/p/")) {
        normalizedUrl = url.replace(
          /https:\/\/(www\.)?dailydoseofds\.com\//,
          "https://blog.dailydoseofds.com/",
        );
      } else {
        normalizedUrl = url.replace(
          "https://dailydoseofds.com/",
          "https://www.dailydoseofds.com/",
        );
      }
      await scrapeHttpFetch(normalizedUrl, tempPath);
    },
    generateUrls: (config: { page?: number }): string[] => {
      const page = config.page || 1;
      return [
        page === 1
          ? `https://www.dailydoseofds.com/archive/`
          : `https://www.dailydoseofds.com/archive/page/${page}/`,
      ];
    },
  },

  converter: {
    converter: new DailyDoseDSConverter(),
    targetCollection: "dailydose_ds.html",
    filter: (id) => ({ id }),
    completedSetKey: "sites:dailydose_ds:completed",
  },

  targetLoader: {
    collectionName: "silver/dailydose_ds.contents",
    filterField: "id",
    buildDocument: (id, meta: DailyDoseDSMeta) => ({
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
