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

import { GeekNewsMeta, GeekNewsComment } from "./site.config";

export class GeekNewsConverter extends BaseConverter<GeekNewsMeta> {
  public async convertHtmlToMarkdown(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<GeekNewsMeta> {
    const $ = cheerio.load(htmlContent);

    // Handle weekly issue pages
    if (id.startsWith("weekly-") || url.includes("/weekly/")) {
      const title =
        $(".weekly-container h2, h2").first().text().trim() ||
        $("title").text().replace(" | GeekNews", "").trim() ||
        "정보 없음";
      const dateStr = $(".weekly-container .date, .date").first().text().trim();
      const descEl = $(".weekly-container .desc, .desc").first();
      let content = "";
      if (descEl.length > 0) {
        const html = descEl.html() || "";
        try {
          const TurndownService = require("turndown");
          const turndownService = new TurndownService({
            headingStyle: "atx",
            hr: "---",
            bullet: "-",
            codeBlockStyle: "fenced",
          });
          content = turndownService.turndown(html).trim();
        } catch (err) {
          content = descEl.text().trim();
        }
      }

      content = this.cleanContent(content);

      let publishedAtStr: string | null = null;
      let jsonLdRaw: string | null = null;
      try {
        const jsonLdScript = $('script[type="application/ld+json"]');
        if (jsonLdScript.length > 0) {
          jsonLdRaw = jsonLdScript.html();
          if (jsonLdRaw) {
            const data = JSON.parse(jsonLdRaw);
            if (data.datePublished) {
              publishedAtStr = data.datePublished;
            }
          }
        }
      } catch (e: any) {
        console.error(`⚠️ JSON-LD 파싱 중 에러 발생: ${e.message}`);
      }

      const publishedAt = DateUtils.parseSafeDate(publishedAtStr);

      let markdown = `# 📰 ${title}\n\n`;
      if (dateStr) {
        markdown += `* **기간:** ${dateStr}\n`;
      }
      if (publishedAt) {
        markdown += `* **발행일:** ${publishedAt.toISOString()}\n`;
      }
      markdown += `* **원문 링크:** [바로가기](${url})\n\n`;
      markdown += `## 📝 주간 요약 설명\n${content}\n`;

      return {
        id,
        title,
        url,
        publishedAt,
        content,
        comments: [],
        jsonLdRaw,
        rawContent: markdown,
      };
    }

    // 1. Extract title
    const title =
      $("title").text().replace(" | GeekNews", "").trim() || "정보 없음";

    // Extract external original link from the title anchor (.topictitle a)
    const topictitleA = $(".topictitle a");
    let externalUrl = topictitleA.attr("href")?.trim() || "";
    if (externalUrl) {
      if (!externalUrl.startsWith("http")) {
        externalUrl = `https://news.hada.io/${externalUrl.replace(/^\//, "")}`;
      }
    } else {
      externalUrl = url; // Fallback to GeekNews topic details URL
    }

    // 2. Extract publication date from JSON-LD or meta
    let publishedAtStr: string | null = null;

    // 2. Extract JSON-LD and comments & content
    const comments: GeekNewsComment[] = [];
    let jsonLdRaw: string | null = null;
    let content = "";

    // 2. Extract JSON-LD for comments only; don't use it for content (strips formatting)
    try {
      const jsonLdScript = $('script[type="application/ld+json"]');
      if (jsonLdScript.length > 0) {
        jsonLdRaw = jsonLdScript.html();
        if (jsonLdRaw) {
          const data = JSON.parse(jsonLdRaw);

          let commentDataList = data.comment || [];
          if (commentDataList && !Array.isArray(commentDataList)) {
            commentDataList = [commentDataList];
          }

          // Extract publication date from JSON-LD
          if (!publishedAtStr && data.datePublished) {
            publishedAtStr = data.datePublished;
          }

          const processJsonLdComment = (commentData: any) => {
            if (!commentData || typeof commentData !== "object") return;
            const text = commentData.text;
            if (text) {
              const commentUrl = commentData.url || "";
              comments.push({
                commentId: commentUrl.includes("id=")
                  ? commentUrl.split("id=").pop()!.split("&")[0]
                  : "",
                author: commentData.author?.name || "Unknown",
                content: text,
              });
            }
            let children = commentData.comment || [];
            if (children && !Array.isArray(children)) {
              children = [children];
            }
            for (const child of children) {
              processJsonLdComment(child);
            }
          };

          for (const commentData of commentDataList) {
            processJsonLdComment(commentData);
          }
        }
      }
    } catch (e: any) {
      console.error(`⚠️ JSON-LD 파싱 중 에러 발생: ${e.message}`);
    }

    // 3. Extract content: prefer topicdesc / topic_contents HTML with TurndownService
    //    (preserves formatting vs JSON-LD which often strips newlines)
    const topicContentsEl = $(".topicdesc, #topic_contents, .topic_contents");
    if (topicContentsEl.length > 0) {
      const html = topicContentsEl.first().html() || "";
      try {
        const TurndownService = require("turndown");
        const turndownService = new TurndownService({
          headingStyle: "atx",
          hr: "---",
          bullet: "-",
          codeBlockStyle: "fenced",
        });
        content = turndownService.turndown(html).trim();
      } catch (err) {
        // Fall through to JSON-LD fallback
      }
    }

    // 4. Fallback to JSON-LD text fields if HTML extraction failed
    if (!content) {
      try {
        const jsonLdScript = $('script[type="application/ld+json"]');
        if (jsonLdScript.length > 0) {
          const raw = jsonLdScript.html();
          if (raw) {
            const data = JSON.parse(raw);
            if (data.articleBody) {
              content = data.articleBody.trim();
            } else if (data.description) {
              content = data.description.trim();
            } else if (data.text) {
              content = data.text.trim();
            }
          }
        }
      } catch (e: any) {
        console.error(`⚠️ JSON-LD 콘텐츠 폴백 중 에러: ${e.message}`);
      }
    }

    // 5. Last resort: .topicdesc / #topic_contents plain text
    if (!content && topicContentsEl.length > 0) {
      content = topicContentsEl.first().text().trim();
    }

    // 4. Fallback to HTML comment parsing if no comments found from JSON-LD
    if (comments.length === 0) {
      $(".comment_row").each((_, el) => {
        const row = $(el);
        const authorEl = row.find('.commentinfo a[href^="/@"]');
        const contentEl = row.find(".comment_contents");
        if (contentEl.length > 0) {
          comments.push({
            commentId: row.attr("id") || "",
            author: authorEl.text().trim() || "Unknown",
            content: contentEl.text().replace(/\n/g, " ").trim(),
          });
        }
      });
    }

    // 5. Clean content
    content = this.cleanContent(content);

    const publishedAt = DateUtils.parseSafeDate(publishedAtStr);

    // 6. Generate Markdown
    let markdown = `# 📰 ${title}\n\n`;
    if (publishedAt) {
      markdown += `* **작성일:** ${publishedAt.toISOString()}\n`;
    }
    markdown += `* **기사 링크:** [바로가기](${externalUrl})\n\n`;
    markdown += `## 📝 요약 설명\n${content}\n\n`;

    if (comments.length > 0) {
      markdown += `## 💬 댓글 및 토론 (${comments.length}개)\n\n`;
      for (const comment of comments) {
        markdown += `### 👤 ${comment.author}\n> ${comment.content}\n\n`;
      }
    }

    return {
      id,
      title,
      url: externalUrl,
      publishedAt,
      content,
      comments,
      jsonLdRaw,
      rawContent: markdown,
    };
  }

  private cleanContent(raw: string): string {
    let c = raw;
    // Strip HTML tags (JSON-LD text sometimes contains raw HTML)
    c = c.replace(/<[^>]*>/g, "");
    // Convert inline dash-separated list to proper markdown bullets
    // (JSON-LD text often flattens multi-line content into "item - item - item")
    const dashCount = (c.match(/\s+-\s+/g) || []).length;
    if (dashCount >= 3 && (c.match(/\n/g) || []).length <= 1) {
      const parts = c.split(/\s+-\s+/);
      if (parts.every((p) => p.trim().length >= 3)) {
        c = parts.map((p) => `- ${p.trim()}`).join("\n");
      }
    }
    // Strip leading article number like "* '#10345'", "* #10345", or "#10345"
    c = c.replace(/^\*?\s*['"#]*\d+\s*['"]*\s*\n?/, "");
    // Normalize list markers: * at line start → -
    c = c.replace(/^[ \t]*\*[ \t]/gm, "- ");
    // Unescape leading dashes (TurndownService escapes when HTML lacks list tags)
    c = c.replace(/^\\- /gm, "- ");
    // Shift heading levels down by 1 (## → ###, ### → ####, etc.), preserve # (h1)
    c = c.replace(
      /^(#{2,})\s/gm,
      (_, hashes: string) => "#".repeat(hashes.length + 1) + " ",
    );
    return c.trimStart();
  }
}
