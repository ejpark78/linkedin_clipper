/**
 * @module scraper
 * @description Core functionality or script runner for scraper.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";

export async function scrapeHttpFetch(
  url: string,
  tempPath: string,
): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP status ${response.status} when scraping ${url}`);
  }
  const html = await response.text();
  fs.writeFileSync(tempPath, html, "utf-8");
}
