/**
 * @module site.config
 * @description Core functionality or script runner for site.config.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, SiteRegistry, Converter
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import type { SiteDescriptor } from "../../core/SiteRegistry";
import { PyTorchKRConverter } from "./Converter";

async function scrapePytorchKr(url: string, tempPath: string): Promise<void> {
  const jsonUrl = url.includes(".json") ? url : `${url}.json`;
  const response = await fetch(jsonUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `PyTorch KR JSON API HTTP status ${response.status} when scraping ${url}`,
    );
  }
  const data = (await response.json()) as any;
  const title: string = data.title || "Unknown Title";
  const createdAt: string = data.created_at || "";
  const cooked: string = data.post_stream?.posts?.[0]?.cooked || "";
  if (!cooked) {
    throw new Error(`No cooked content in JSON API response for ${url}`);
  }
  const html = `<!DOCTYPE html>
<html>
<head><title>${title.replace(/</g, "&lt;")} - PyTorchKR</title>
<link rel="canonical" href="${url}">
<meta property="article:published_time" content="${createdAt}">
</head>
<body>
<div class="post" itemprop="text">${cooked}</div>
</body>
</html>`;
  fs.writeFileSync(tempPath, html, "utf-8");
}

import { Document } from "mongodb";

export interface PyTorchListDocument extends Document {
  _id: string;
  collectedAt: Date;
}

export interface PyTorchKRMeta {
  id: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  content: string;
  rawContent: string;
}

export const descriptor: SiteDescriptor = {
  key: "pytorch_kr",
  name: "PyTorch KR",
  domain: "discuss.pytorch.kr",
  favicon:
    "https://discuss.pytorch.kr/uploads/default/optimized/1X/a15555c82ffc1409ffc05e1adbe5f9cf8e1cc385_2_32x32.png",
  indexName: "pytorch_kr",

  indexes: [
    {
      collection: "bronze/pytorch_kr.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/pytorch_kr.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "bronze/pytorch_kr.urls", fields: { status: 1, id: 1 } },
    {
      collection: "silver/pytorch_kr.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "silver/pytorch_kr.contents", fields: { publishedAt: -1 } },
    {
      collection: "silver/pytorch_kr.contents",
      fields: { title: "text", content: "text", markdown: "text", url: "text" },
      options: {
        weights: { title: 10, content: 5, markdown: 3, url: 1 },
        name: "text_idx",
      },
    },
  ],

  listsCollectionName: "bronze/pytorch_kr.lists",

  scraper: {
    collectionName: "bronze/pytorch_kr.html",
    targetCollection: "pytorch_kr.html",
    updateFilterKey: "id",
    defaultSlack: 3,
    extractId: (url) => {
      const match = url.match(/\/(\d+)(?:\?|$)/);
      return match ? match[1] : "";
    },
    excludePatterns: ["favicon", "login", "logout", "signup"],
    urlsCollectionName: "bronze/pytorch_kr.urls",
    scrape: scrapePytorchKr,
    generateUrls: (config: { page?: number }): string[] => {
      const page = config.page || 1;
      return [
        `https://discuss.pytorch.kr/latest.json?no_definitions=true&page=${page}`,
      ];
    },
  },

  converter: {
    converter: new PyTorchKRConverter(),
    targetCollection: "pytorch_kr.html",
    filter: (id) => ({ $or: [{ topicId: id }, { id: id }] }),
    statusCollection: "bronze/pytorch_kr.urls",
    completedSetKey: "sites:pytorch_kr:completed",
  },

  targetLoader: {
    collectionName: "silver/pytorch_kr.contents",
    filterField: "id",
    buildDocument: (id, meta: PyTorchKRMeta) => ({
      id,
      title: meta.title || "Untitled",
      url: meta.url || null,
      publishedAt: meta.publishedAt || null,
      content: meta.content || null,
      markdown: meta.rawContent || null,
      updatedAt: new Date(),
    }),
  },

  refreshSilver: {
    imageDownload: {
      enabled: true,
      removeFavicons: true,
    },
  },
};
