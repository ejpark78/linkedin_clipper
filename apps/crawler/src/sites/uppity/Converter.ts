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

import { UppityMeta } from "./site.config";

export class UppityConverter extends BaseConverter<UppityMeta> {
  public async convertHtmlToMarkdown(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<UppityMeta> {
    const $ = cheerio.load(htmlContent);

    const canonical = $('link[rel="canonical"]').attr("href");
    const finalUrl = canonical || url;

    const ogTitle = $('meta[property="og:title"]').attr("content");
    const titleTag = $("title")
      .text()
      .trim()
      .replace(/ - UPPITY.*$/, "")
      .replace(/ \| UPPITY.*$/, "");
    const title = ogTitle || titleTag || "Unknown Title";

    let publishedAtStr: string | null = null;
    const metaTime = $('meta[property="article:published_time"]').attr(
      "content",
    );
    if (metaTime) {
      publishedAtStr = metaTime;
    } else {
      const timeTag = $("time[datetime]").first();
      if (timeTag.length) {
        publishedAtStr = timeTag.attr("datetime") || null;
      }
    }

    const publishedAt = DateUtils.parseSafeDate(publishedAtStr);

    const contentHtml = this.extractContentHtml($);
    const contentText = this.htmlToMarkdown(contentHtml);
    const cleanedContent = this.cleanContent(contentText);

    let markdown = `# ${title}\n\n`;
    if (publishedAt) {
      markdown += `* **작성일:** ${publishedAt.toISOString()}\n`;
    } else {
      markdown += `* **작성일:** 정보 없음\n`;
    }
    markdown += `* **원본 링크:** [바로가기](${finalUrl})\n\n`;
    markdown += `## 내용\n\n${cleanedContent}\n`;

    return {
      id,
      title,
      url: finalUrl,
      publishedAt,
      content: cleanedContent,
      rawContent: markdown,
    };
  }

  private extractContentHtml($: cheerio.CheerioAPI): string {
    const selectors = [
      ".elementor-widget-theme-post-content .elementor-widget-container",
      ".elementor-widget-theme-post-content",
      "article .entry-content",
      ".entry-content",
      "article .elementor-widget-container",
      "article.post-content",
      ".post-content",
      "article",
    ];
    for (const sel of selectors) {
      const el = $(sel).first();
      if (el.length > 0) {
        const html = el.html();
        if (html && html.trim().length > 50) {
          return html;
        }
      }
    }
    const bodyHtml = $("body").html() || "";
    return bodyHtml;
  }

  private cleanContent(content: string): string {
    return content.trim();
  }
}
