/**
 * @module Converter
 * @description Core functionality or script runner for Converter.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies cheerio, turndown, IConverter
 * @lastUpdated 2026-06-11
 */

import * as cheerio from "cheerio";
import { BaseConverter } from "../../core/BaseConverter";
import { DateUtils } from "../../utils/DateUtils";
import TurndownService from "turndown";

import { DailyDoseDSMeta } from "./site.config";

export class DailyDoseDSConverter extends BaseConverter<DailyDoseDSMeta> {
  public async convertHtmlToMarkdown(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<DailyDoseDSMeta> {
    const $ = cheerio.load(htmlContent);

    // 1. Basic Cleanup: Remove only clearly non-content elements
    $(".gh-nav-list, .gh-pagination, #sx-footer, .pswp").remove();

    const title =
      $("h1").first().text().trim() ||
      $("title").text().split("|")[0].trim() ||
      "Unknown Title";
    const publishedAtStr =
      $("time").first().attr("datetime") ||
      $("div[data-sx-updated-on]").first().text().trim() ||
      null;
    const publishedAt = DateUtils.parseSafeDate(publishedAtStr);

    // 2. Content Extraction - Follow the successful unit test pattern
    const contentEl = $("main").first();

    if (contentEl.length) {
      const clone = contentEl.clone();

      // Remove problematic tags that introduce la-style whitespace
      clone
        .find("aside, footer, .js-toc-ignore, .gh-nav-list, .gh-pagination")
        .remove();

      const turndownService = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        emDelimiter: "*",
        bulletListMarker: "-",
      });

      let contentText = turndownService.turndown(clone.html() || "").trim();

      // Post-process to fix [ \n Title](url) cases and normalize spacing
      contentText = contentText
        .replace(/\[\s*([\r\n\t ]+)?([^\]]*?)\]/g, "[$2]")
        .replace(/(\[.*?\])\(\s*([\r\n\t ]+)?(.*?)\)/g, "$1($3)")
        .replace(/\n\s*\n\s*\n/g, "\n\n");

      // Extract links from "## ... Course" sections
      const discoveredUrls: string[] = [];
      $("a").each((_, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr("href") || "";
        if (
          href &&
          href.includes("dailydoseofds.com") &&
          (text.toLowerCase().includes("course") ||
            text.toLowerCase().includes("lesson"))
        ) {
          discoveredUrls.push(href);
        }
      });

      const rawContent =
        `# 📂 [Daily Dose of DS] ${title}\n\n` +
        `* **작성일:** ${publishedAt ? publishedAt.toISOString() : "정보 없음"}\n` +
        `* **원본 링크:** [바로가기](${url})\n\n` +
        `## 📝 본문 내용\n\n${contentText}\n`;

      return {
        id,
        title,
        url,
        publishedAt,
        content: contentText,
        rawContent,
        discoveredUrls,
      };
    }

    return {
      id,
      title,
      url,
      publishedAt,
      content: "",
      rawContent: "Content not found",
      discoveredUrls: [],
    };
  }
}
