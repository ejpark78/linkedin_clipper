/**
 * @module site.config
 * @description Core functionality or script runner for site.config.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 *   - Excludes auth, sign-in, sign-up, and redirection URLs.
 * @dependencies SiteRegistry, Converter, scraper, crypto
 * @lastUpdated 2026-06-11
 */

import type { SiteDescriptor } from "../../../core/SiteRegistry";
import { MailyJoshConverter } from "./Converter";
import { scrapeHttpFetch } from "../../../utils/scraper";

export interface MailyJoshMeta {
  id: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  category: string | null;
  viewCount: string | null;
  content: string;
  rawContent: string;
}

export const descriptor: SiteDescriptor = {
  key: "maily_josh",
  name: "조쉬의 뉴스레터 (Maily)",
  domain: "maily.so",
  favicon: "https://maily.so/favicon.ico",
  indexName: "maily_josh",

  indexes: [
    {
      collection: "bronze/maily_josh.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/maily_josh.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "bronze/maily_josh.urls", fields: { status: 1, id: 1 } },
    {
      collection: "silver/maily_josh.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "silver/maily_josh.contents", fields: { publishedAt: -1 } },
    {
      collection: "silver/maily_josh.contents",
      fields: { title: "text", content: "text", markdown: "text", url: "text" },
      options: {
        weights: { title: 10, content: 5, markdown: 3, url: 1 },
        name: "text_idx",
      },
    },
  ],

  scraper: {
    collectionName: "bronze/maily_josh.html",
    targetCollection: "maily_josh.html",
    updateFilterKey: "id",
    defaultSlack: 3,
    excludePatterns: [
      "/users/sign_in",
      "/users/sign_up",
      "redirect_path=",
      "/auth/",
      "favicon",
      "login",
      "logout",
      "signup",
    ],
    urlFilter: (url: string) =>
      /^https:\/\/maily\.so\/josh\/posts\/[a-zA-Z0-9]+$/.test(
        url.split("?")[0],
      ),
    extractId: (url) => {
      const crypto = require("crypto");
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
      return crypto.createHash("md5").update(normalized).digest("hex");
    },
    urlsCollectionName: "bronze/maily_josh.urls",
    scrape: scrapeHttpFetch,
    generateUrls: (config: { page?: number }): string[] => {
      const page = config.page || 1;
      const PAGE_PARAMS =
        "controller=spaces%2Fpages&action=home&space_url=josh";
      return [`https://maily.so/josh?page=${page}&${PAGE_PARAMS}`];
    },
  },

  converter: {
    converter: new MailyJoshConverter(),
    targetCollection: "maily_josh.html",
    filter: (id) => ({ id }),
    statusCollection: "bronze/maily_josh.urls",
    completedSetKey: "sites:maily_josh:completed",
  },

  targetLoader: {
    collectionName: "silver/maily_josh.contents",
    filterField: "id",
    buildDocument: (id, meta: MailyJoshMeta) => ({
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
