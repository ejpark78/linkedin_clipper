/**
 * @module site.config
 * @description Core functionality or script runner for site.config.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies SiteRegistry, Converter, scraper, crypto
 * @lastUpdated 2026-06-11
 */

import type { SiteDescriptor } from "../../core/SiteRegistry";
import { UppityConverter } from "./Converter";
import { scrapeHttpFetch } from "../../utils/scraper";

export const SECTIONS = [
  { slug: "economy-news", name: "머니뉴스" },
  { slug: "column-before/uppity-original", name: "어피티 오리지널" },
  { slug: "column-before/expert-contribution", name: "전문가 기고" },
  { slug: "column-before/moneylog", name: "머니로그" },
  { slug: "economy-dictionary", name: "머니사전" },
  { slug: "newsletter/money-letter", name: "머니레터" },
  { slug: "newsletter/jalsseul-letter", name: "잘쓸레터" },
  { slug: "newsletter/career-letter", name: "커리어레터" },
  // Legacy sections prefixed with category path for compatibility
  { slug: "category/cloumn/어피티-오리지널", name: "레거시 오리지널" },
  { slug: "category/cloumn/전문가-기고", name: "레거시 전문가 기고" },
  { slug: "category/cloumn/moneylog", name: "레거시 머니로그" },
  { slug: "category/news", name: "레거시 뉴스" },
  { slug: "category/newsletter", name: "레거시 뉴스레터" },
  { slug: "2030-research", name: "2030 리서치" },
];

export interface UppityMeta {
  id: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  content: string;
  rawContent: string;
}

export const descriptor: SiteDescriptor = {
  key: "uppity",
  name: "Uppity",
  domain: "uppity.co.kr",
  favicon: "https://uppity.co.kr/favicon.ico",
  indexName: "uppity",

  indexes: [
    {
      collection: "bronze/uppity.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/uppity.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "bronze/uppity.urls", fields: { status: 1, id: 1 } },
    {
      collection: "silver/uppity.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "silver/uppity.contents", fields: { publishedAt: -1 } },
    {
      collection: "silver/uppity.contents",
      fields: { title: "text", content: "text", markdown: "text", url: "text" },
      options: {
        weights: { title: 10, content: 5, markdown: 3, url: 1 },
        name: "text_idx",
      },
    },
  ],

  scraper: {
    collectionName: "bronze/uppity.html",
    targetCollection: "uppity.html",
    updateFilterKey: "id",
    defaultSlack: 3,
    extractId: (url) => {
      const crypto = require("crypto");
      let normalized = url;
      try {
        normalized = decodeURIComponent(url).trim();
      } catch {}
      try {
        const parsed = new URL(normalized);
        parsed.protocol = "https:";
        if (parsed.hostname.startsWith("www.")) {
          parsed.hostname = parsed.hostname.substring(4);
        }
        let cleanPath = parsed.pathname.replace(/\/$/, "");
        if (/\/\d+$/.test(cleanPath)) {
          cleanPath = cleanPath.replace(/\/\d+$/, "");
        }
        parsed.pathname = cleanPath;
        normalized = parsed.toString();
      } catch {}
      return crypto.createHash("md5").update(normalized).digest("hex");
    },
    excludePatterns: [
      "logout.cm",
      "login",
      "join",
      "signup",
      "favicon",
      "logout",
      "unsubscribe",
    ],
    urlFilter: (urlStr: string): boolean => {
      try {
        const parsed = new URL(urlStr);
        // Exclude patterns
        const exclude = [
          "logout.cm",
          "login",
          "join",
          "signup",
          "favicon",
          "logout",
          "/category/",
          "/tag/",
          "/author/",
          "/page/",
          "#",
          "download.cm",
          "unsubscribe",
        ];
        if (
          exclude.some(
            (p) => parsed.pathname.includes(p) || parsed.hash.includes(p),
          )
        ) {
          return false;
        }

        // If it is an explicit board view detail page, allow it immediately
        if (parsed.searchParams.get("bmode") === "view") {
          return true;
        }

        // Exclude section list and archive root pages
        const cleanPath = parsed.pathname.replace(/\/$/, "");
        if (!cleanPath || cleanPath === "/") {
          return false;
        }

        const excludePaths = [
          "/newsletter",
          "/column-before",
          "/economy-dictionary",
          "/economy-news",
          "/column-before/uppity-original",
          "/column-before/expert-contribution",
          "/column-before/moneylog",
          "/newsletter/money-letter",
          "/newsletter/jalsseul-letter",
          "/newsletter/career-letter",
          "/2030-research",
          "/serial",
          "/moneyletter_archive",
          "/careerletter_archive",
          "/moneylog",
          "/news",
          "/notice",
          "/uppitag",
          "/bamboo_forest",
          "/column",
          "/partnership",
        ];
        if (
          excludePaths.includes(cleanPath) ||
          excludePaths.some((p) => cleanPath.startsWith(p + "/")) ||
          /\/page\/\d+$/.test(cleanPath) ||
          /\/\d+$/.test(cleanPath)
        ) {
          return false;
        }

        // Query param validation
        const hasQ = parsed.searchParams.has("q");
        const hasPage =
          parsed.searchParams.has("page") || parsed.pathname.includes("/page/");
        if (hasQ || hasPage) {
          return false;
        }

        // If URL has search query, it MUST be a view page (bmode=view) to be a detail page
        if (
          parsed.search.length > 0 &&
          parsed.searchParams.get("bmode") !== "view"
        ) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
    urlsCollectionName: "bronze/uppity.urls",
    scrape: scrapeHttpFetch,
    generateUrls: (config: { page?: number; section?: string }): string[] => {
      const page = config.page || 1;
      const section = config.section || "economy-news";
      return [
        page === 1
          ? `https://uppity.co.kr/${section}/`
          : `https://uppity.co.kr/${section}/page/${page}/`,
      ];
    },
  },

  converter: {
    converter: new UppityConverter(),
    targetCollection: "uppity.html",
    filter: (id) => ({ id }),
    statusCollection: "bronze/uppity.urls",
    completedSetKey: "sites:uppity:completed",
  },

  targetLoader: {
    collectionName: "silver/uppity.contents",
    filterField: "id",
    buildDocument: (id, meta: UppityMeta) => ({
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
