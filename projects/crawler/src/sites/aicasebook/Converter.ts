/**
 * @module Converter
 * @description Core functionality or script runner for Converter.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies cheerio, prettier, IConverter, turndown, fs
 * @lastUpdated 2026-06-11
 */

import * as cheerio from "cheerio";
import { BaseConverter } from "../../core/BaseConverter";
import { DateUtils } from "../../utils/DateUtils";

import { AiCasebookMeta } from "./site.config";

export class AiCasebookConverter extends BaseConverter<AiCasebookMeta> {
  public async convertHtmlToMarkdown(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<AiCasebookMeta> {
    const $ = cheerio.load(htmlContent);

    // Extract title from <title>
    const title =
      $("title")
        .first()
        .text()
        .replace(/\s*\|\s*aicasebook\.dev\s*$/, "")
        .trim() || "정보 없음";

    // Extract meta description (summary)
    const summary = $('meta[name="description"]').attr("content") || "";

    // Extract author
    const author = $('meta[property="article:author"]').attr("content") || "";

    // Extract published time (Unix ms timestamp string)
    const publishedAtStr =
      $('meta[property="article:published_time"]').attr("content") || null;
    let publishedAt: Date | null = null;
    if (publishedAtStr) {
      const ts = parseInt(publishedAtStr, 10);
      if (!isNaN(ts)) {
        publishedAt = DateUtils.parseSafeDate(new Date(ts));
      } else {
        publishedAt = DateUtils.parseSafeDate(publishedAtStr);
      }
    }

    // Extract categories and tags from keywords meta
    const keywords = $('meta[name="keywords"]').attr("content") || "";
    const tags = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    // Extract categories from og:type or infer from tags
    const categories: string[] = [];
    if (tags.includes("LLM_APPLICATION")) categories.push("LLM 응용");
    if (tags.includes("DEV_EFFICIENCY")) categories.push("개발 효율성");

    // Extract article body from hidden SSR content (.markdown-body)
    let bodyHtml = "";
    const markdownBody = $(".markdown-body");
    if (markdownBody.length > 0) {
      bodyHtml = markdownBody.first().html() || "";
    }

    // Fallback: look inside hidden SSR container
    if (!bodyHtml) {
      const hiddenDiv = $("div[hidden] div.markdown-body");
      if (hiddenDiv.length > 0) {
        bodyHtml = hiddenDiv.first().html() || "";
      }
    }

    // Extract source link (original article URL)
    let sourceLink = "";
    const originalLink = $("a[href].bg-\\[var\\(--accent-warm\\)\\]").first();
    if (originalLink.length > 0) {
      sourceLink = originalLink.attr("href") || "";
    }
    if (!sourceLink) {
      const allLinks = $('a[target="_blank"][rel="noopener noreferrer"]');
      allLinks.each((_, el) => {
        const href = $(el).attr("href") || "";
        if (href.startsWith("http") && !href.includes("aicasebook.dev")) {
          sourceLink = href;
          return false;
        }
      });
    }

    // Extract series name
    let seriesName: string | null = null;
    $("span").each((_, el) => {
      const text = $(el).text().trim();
      if (
        text.includes("기업 사례") ||
        text.includes("레딧") ||
        text.includes("소스 분석")
      ) {
        const parentText = $(el).closest("div").text();
        const seriesMatch = parentText.match(/◆(.+)/);
        if (seriesMatch) {
          seriesName = seriesMatch[1].trim();
        }
      }
    });

    // Extract views
    let views = 0;
    const bodyText = $("body").text();
    const viewsMatch = bodyText.match(/조회\s*(\d+)/);
    if (viewsMatch) {
      views = parseInt(viewsMatch[1], 10);
    }

    // Convert body HTML to Markdown
    let bodyMarkdown = "";
    if (bodyHtml) {
      try {
        const TurndownService = require("turndown");
        const turndownService = new TurndownService({
          headingStyle: "atx",
          hr: "---",
          bullet: "-",
          codeBlockStyle: "fenced",
        });
        bodyMarkdown = turndownService.turndown(bodyHtml).trim();
      } catch (err) {
        bodyMarkdown = $(bodyHtml).text().trim();
      }
    }

    // Assemble markdown
    let markdown = `# ${title}\n\n`;
    if (summary) {
      markdown += `> ${summary}\n\n`;
    }
    markdown += `* **작성자:** ${author || "정보 없음"}\n`;
    if (publishedAt) {
      markdown += `* **작성일:** ${publishedAt.toISOString()}\n`;
    }
    if (sourceLink) {
      markdown += `* **원본 링크:** [바로가기](${sourceLink})\n`;
    }
    if (seriesName) {
      markdown += `* **시리즈:** ${seriesName}\n`;
    }
    if (tags.length > 0) {
      markdown += `* **태그:** ${tags.join(", ")}\n`;
    }
    markdown += `* **조회수:** ${views}\n\n`;
    markdown += `---\n\n`;
    markdown += bodyMarkdown;

    return {
      id,
      title,
      url,
      summary,
      body: bodyMarkdown,
      author,
      categories,
      tags,
      publishedAt,
      views,
      sourceLink,
      seriesName,
      rawContent: markdown,
    };
  }
}
