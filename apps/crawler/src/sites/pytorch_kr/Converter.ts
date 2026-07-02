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

import { PyTorchKRMeta } from "./site.config";

export class PyTorchKRConverter extends BaseConverter<PyTorchKRMeta> {
  public async convertHtmlToMarkdown(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<PyTorchKRMeta> {
    const $ = cheerio.load(htmlContent, { _useHtmlParser2: true } as any);

    // Extract canonical URL if available
    const canonical = $('link[rel="canonical"]').attr("href");
    const finalUrl = canonical || url;

    // Extract title
    let title = "";

    // 1. Try blog layout title
    const blogTitle = $("h1 a.blog-title").first().text().trim();
    if (blogTitle) {
      title = blogTitle;
    }

    // 2. Fallback to <title> tag
    if (!title) {
      title = $("title").text() || "Unknown Title";
      const sep = title.includes(" | ") ? " | " : " - ";
      title = title.split(sep)[0];
    }

    // Extract publication date
    let publishedAtStr: string | null = null;

    // 1. Try blog layout date
    const featuredPost = $("p.featured-post").first().text().trim();
    if (featuredPost) {
      publishedAtStr = featuredPost;
    }

    // 2. Try <time datetime> tag
    if (!publishedAtStr) {
      const timeTag = $("time[datetime]").first();
      if (timeTag.length) {
        publishedAtStr = timeTag.attr("datetime") || null;
      }
    }

    // 3. Try meta property
    if (!publishedAtStr) {
      const metaTime = $('meta[property="article:published_time"]').attr(
        "content",
      );
      if (metaTime) publishedAtStr = metaTime;
    }

    const publishedAt = DateUtils.parseSafeDate(publishedAtStr);

    // Extract content from built-in selectors (synchronous HTML parse)
    const contentText = this.extractContentFromHtml($, title);

    // Build result
    const fullContent = `${title}\n${contentText}`;

    let markdown = `# 📂 [PyTorch KR] ${title}\n\n`;
    if (publishedAt) {
      markdown += `* **작성일:** ${publishedAt.toISOString()}\n`;
    } else {
      markdown += `* **작성일:** 정보 없음\n`;
    }
    markdown += `* **원본 링크:** [바로가기](${finalUrl})\n\n`;
    markdown += `## 📝 본문 내용\n\n${contentText}\n`;

    return {
      id,
      title,
      url: finalUrl,
      publishedAt,
      content: fullContent,
      rawContent: markdown,
    };
  }

  private extractContentFromHtml($: cheerio.CheerioAPI, title: string): string {
    let contentText = "";
    // Collect image URLs for download tracking
    const imageUrls: Array<{ src: string; alt: string }> = [];

    // 1. Try Discourse post layout (forum topics)
    const postDiv = $('div.post[itemprop="text"]').first();
    if (postDiv.length > 0) {
      // Extract actual markdown from the cooked HTML for forum posts
      const TurndownService = require("turndown");
      const turndownService = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        emDelimiter: "*",
        bulletListMarker: "-",
      });

      // Handle lightbox wrappers first to preserve image links and captions
      postDiv.find("div.lightbox-wrapper").each((_, el) => {
        const lb = $(el);
        const img = lb.find("img");
        const src = img.attr("src") || "";
        const alt = img.attr("alt") || "";
        const link = lb.find("a.lightbox");
        const fullSrc = link.attr("href") || src;
        const info = lb.find("span.informations");
        const infoText = info.text() || "";

        const markdown = `![${alt || ""}](${fullSrc})${infoText ? `\n*${infoText}*` : ""}`;
        lb.replaceWith(markdown);
      });

      // Handle emojis or specific images to prevent noise in markdown
      postDiv.find("img").each((_, el) => {
        const img = $(el);
        const alt = img.attr("alt") || "";
        if (alt.startsWith(":")) {
          img.remove();
        }
      });

      contentText = turndownService.turndown(postDiv.html() || "").trim();
    }

    // 2. Try blog page layout (pytorch.kr/blog/...)
    if (!contentText) {
      const blogContent = $("article.pytorch-article div.blog-content").first();
      if (blogContent.length > 0) {
        const TurndownService = require("turndown");
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
          emDelimiter: "*",
          bulletListMarker: "-",
        });
        const html = blogContent.html() || "";
        contentText = turndownService.turndown(html).trim();
      }
    }

    return contentText;
  }

  public async fetchAndConvertFromJsonApi(
    url: string,
    id: string,
  ): Promise<PyTorchKRMeta | null> {
    const jsonUrl = url.includes(".json") ? url : `${url}.json`;
    try {
      const response = await fetch(jsonUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (!response.ok) return null;

      const data = (await response.json()) as any;
      const title: string = data.title || "Unknown Title";
      const createdAt: string = data.created_at || "";
      const cooked: string = data.post_stream?.posts?.[0]?.cooked || "";
      if (!cooked) return null;

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

      return this.convertHtmlToMarkdown(html, id, url);
    } catch {
      return null;
    }
  }
}
