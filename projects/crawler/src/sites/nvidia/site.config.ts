import type { SiteDescriptor } from "../../core/SiteRegistry";
import { chromium } from "playwright";
import * as fs from "fs";
import * as crypto from "crypto";

export const START_URL = "https://www.nvidia.com/en-us/omniverse/";

export const descriptor: SiteDescriptor = {
  key: "nvidia",
  name: "NVIDIA Omniverse",
  domain: "nvidia.com",
  favicon: "https://www.nvidia.com/favicon.ico",
  indexName: "nvidia",

  indexes: [
    {
      collection: "bronze/nvidia.html",
      fields: { id: 1 },
      options: { unique: true },
    },
    {
      collection: "bronze/nvidia.urls",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "bronze/nvidia.urls", fields: { status: 1, id: 1 } },
  ],

  scraper: {
    collectionName: "bronze/nvidia.html",
    targetCollection: "nvidia.html",
    updateFilterKey: "id",
    defaultSlack: 1, // SLACK_TIME 기본값 1초
    extractId: (url: string) => {
      return crypto
        .createHash("md5")
        .update(url)
        .digest("hex")
        .substring(0, 16);
    },
    excludePatterns: ["favicon", "login", "logout", "signup"],
    urlsCollectionName: "bronze/nvidia.urls",
    urlFilter: (url: string) => {
      // url에 omniverse가 들어간 경우만 필터링
      return url.includes("omniverse");
    },
    scrape: async (url: string, tempHtmlPath: string) => {
      console.log(`🌐 [Nvidia Scrape] Launching Playwright to scrape: ${url}`);
      const browser = await chromium.launch({
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
      try {
        const context = await browser.newContext({
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          locale: "en-US",
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

        const buttonTexts = ["Load more", "Load More", "Next page"];
        let clickCount = 0;
        const maxClicks = 20;

        while (clickCount < maxClicks) {
          let clicked = false;
          for (const text of buttonTexts) {
            // "Load more", "Load More", "Next page" 문구를 포함하는 버튼 또는 링크 탐색
            const locator = page
              .locator(`button:has-text("${text}"), a:has-text("${text}")`)
              .first();
            try {
              if (await locator.isVisible({ timeout: 2000 })) {
                console.log(
                  `[Nvidia Scrape] Found button with text "${text}". Clicking (Count: ${clickCount + 1})...`,
                );
                await locator.click();
                await page.waitForTimeout(2000);
                clicked = true;
                clickCount++;
                break;
              }
            } catch (err) {
              // Locator timeout or invisible
            }
          }
          if (!clicked) break;
        }

        const html = await page.content();
        fs.writeFileSync(tempHtmlPath, html, "utf-8");
        console.log(
          `💾 [Nvidia Scrape] Successfully saved HTML for URL: ${url}`,
        );
      } finally {
        await browser.close();
      }
    },
  },
};
