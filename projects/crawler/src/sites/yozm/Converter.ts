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
import { YozmMeta } from "./site.config";
import { DateUtils } from "../../utils/DateUtils";

export class YozmConverter extends BaseConverter<YozmMeta> {
  private findNewsLd($: cheerio.CheerioAPI): Record<string, any> | null {
    let result: Record<string, any> | null = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      const text = $(el).html();
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        if (parsed["@type"] === "NewsArticle") {
          result = parsed;
        }
      } catch {}
    });
    return result;
  }

  public async convertHtmlToMarkdown(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<YozmMeta> {
    const $ = cheerio.load(htmlContent);

    const canonical = $('link[rel="canonical"]').attr("href");
    const finalUrl = canonical || url;

    const ogTitle = $('meta[property="og:title"]').attr("content");
    const titleTag = $("title").text().trim();
    const title = (ogTitle || titleTag || "Unknown Title").replace(
      /\s*\|\s*요즘IT$/,
      "",
    );

    const newsLd = this.findNewsLd($);

    let publishedAtStr: string | null = null;
    if (newsLd?.datePublished) {
      publishedAtStr = newsLd.datePublished;
    }

    const publishedAt = DateUtils.parseSafeDate(publishedAtStr);

    let category: string | null = null;
    if (newsLd?.articleSection) {
      category = newsLd.articleSection;
    }
    if (!category) {
      const categoryLink = $(
        'a[data-testid="contentsItem-category-link"]',
      ).first();
      if (categoryLink.length) {
        category = categoryLink.text().trim();
      }
    }

    let author: string | null = null;
    if (newsLd?.author?.name) {
      author = newsLd.author.name;
    }
    if (author === "요즘IT") {
      const authorEl = $(
        'a[href*="/magazine/@"], a[href*="/magazine/@"]',
      ).first();
      if (authorEl.length) {
        const realAuthor = authorEl.text().trim();
        if (realAuthor) author = realAuthor;
      }
    }

    let contentMarkdown: string = "";

    // 요즘IT는 Next.js 스트리밍 방식을 사용하여 본문이 main[data-id="detail-contents"] 내부에 고정되어 있지 않고,
    // S:3 등 동적으로 생성된 스트리밍 chunk div 내부에 렌더링될 수 있습니다.
    // 본문 단락(.typo-contents16)의 부모 컨테이너를 찾아 본문 HTML 영역을 확보합니다.
    let contentContainer = $('main[data-id="detail-contents"]');
    const typoParagraphs = $(".typo-contents16");
    if (typoParagraphs.length > 0) {
      const parentCounts = new Map<any, number>();
      typoParagraphs.each((_, el) => {
        let parent = $(el).parent();
        // blockquote, ul, ol, li, a, span 등 레이아웃/스타일링용 태그는 본문 컨테이너로 삼기 부적절하므로 조상을 탐색합니다.
        while (
          parent.length > 0 &&
          ["blockquote", "ul", "ol", "li", "a", "span", "div"].includes(
            (parent[0] as any).name,
          )
        ) {
          // 단, parent가 div이고 id나 class가 있는 경우는 의미 있는 스트리밍 컨테이너(예: id="S:3")일 수 있으므로 탐색을 멈춥니다.
          if (
            (parent[0] as any).name === "div" &&
            (parent.attr("id") || parent.attr("class"))
          ) {
            break;
          }
          const nextParent = parent.parent();
          if (
            nextParent.length === 0 ||
            (nextParent[0] as any).name === "body" ||
            (nextParent[0] as any).name === "html"
          ) {
            break;
          }
          parent = nextParent;
        }
        if (parent.length > 0) {
          const rawEl = parent[0];
          parentCounts.set(rawEl, (parentCounts.get(rawEl) || 0) + 1);
        }
      });

      let maxParent: any = null;
      let maxCount = 0;
      for (const [parent, count] of parentCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          maxParent = parent;
        }
      }
      if (maxParent) {
        contentContainer = $(maxParent);
      }
    }

    const detailHtml = contentContainer.html();
    if (detailHtml && detailHtml.trim().length > 50) {
      contentMarkdown = this.htmlToMarkdown(detailHtml);
    }

    if (!contentMarkdown || contentMarkdown === "(content extraction failed)") {
      let bodyText = "";
      if (newsLd?.articleBody) {
        bodyText = newsLd.articleBody
          .replace(/&nbsp;/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
      contentMarkdown = bodyText || "(content extraction failed)";
    }

    let markdown = `# ${title}\n\n`;
    if (category) {
      markdown += `* **카테고리:** ${category}\n`;
    }
    if (publishedAt) {
      markdown += `* **발행일:** ${publishedAt.toISOString()}\n`;
    }
    if (author) {
      markdown += `* **작가:** ${author}\n`;
    }
    markdown += `* **원본 링크:** [바로가기](${finalUrl})\n\n`;
    markdown += `---\n\n${contentMarkdown}\n`;

    return {
      id,
      title,
      url: finalUrl,
      publishedAt,
      category,
      author,
      content: contentMarkdown,
      rawContent: markdown,
    };
  }
}
