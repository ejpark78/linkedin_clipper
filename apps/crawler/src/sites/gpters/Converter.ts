/**
 * @module Converter
 * @description Core functionality or script runner for Converter.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies prettier, IConverter, fs, path
 * @lastUpdated 2026-06-11
 */

import { BaseConverter } from "../../core/BaseConverter";
import { DateUtils } from "../../utils/DateUtils";

import { GptersMeta, descriptor } from "./news/site.config";

export class GptersConverter extends BaseConverter<GptersMeta> {
  public async convertHtmlToMarkdown(
    htmlOrJsonContent: string,
    id: string,
    url: string,
  ): Promise<GptersMeta> {
    let post: any = {};
    try {
      post = JSON.parse(htmlOrJsonContent);
    } catch (e) {
      post = { title: "No Title", shortContent: htmlOrJsonContent };
    }

    const title = post.title || "No Title";
    const author =
      post.author?.name || post.createdBy?.member?.name || "Unknown";
    // fields.content has the full HTML body; shortContent is truncated
    const fieldsMap: Record<string, string> = {};
    if (Array.isArray(post.fields)) {
      for (const f of post.fields) {
        fieldsMap[f.key] = f.value;
      }
    }
    const longContent = (fieldsMap.content || post.shortContent || "").replace(
      /\\(["nrt\\])/g,
      (_: string, c: string) =>
        (
          ({ '"': '"', n: "\n", r: "\r", t: "\t", "\\": "\\" }) as Record<
            string,
            string
          >
        )[c] || _,
    );

    const publishedAtStr = post.createdAt || null;
    const publishedAt = DateUtils.parseSafeDate(publishedAtStr);

    const reactionsCount = post.reactionsCount || 0;
    const repliesCount = post.repliesCount || 0;
    const finalUrl =
      url || `https://www.${descriptor.domain}/news/post/${post.slug}-${id}`;
    const spaceId = post.space?.id || null;
    const spaceName = post.space?.name || null;
    const spaceSlug = post.space?.slug || null;

    // Create a Markdown output
    let markdown = `# 💡 [GPTERS] ${title}\n\n`;
    markdown += `* **작성자:** ${author}\n`;
    if (spaceName) markdown += `* **스페이스:** ${spaceName}\n`;
    if (publishedAt) {
      markdown += `* **작성일:** ${publishedAt.toISOString()}\n`;
    } else {
      markdown += `* **작성일:** 정보 없음\n`;
    }
    markdown += `* **리액션:** 👍 ${reactionsCount} | 💬 ${repliesCount}\n`;
    markdown += `* **원본 링크:** [바로가기](${finalUrl})\n\n`;
    markdown += `## 📝 내용\n\n${longContent}\n`;

    return {
      id,
      title,
      url: finalUrl,
      author,
      shortContent: longContent,
      publishedAt,
      reactionsCount,
      repliesCount,
      rawContent: markdown,
      spaceId,
      spaceName,
      spaceSlug,
    };
  }

  public async prettifyJson(rawJsonStr: string): Promise<string> {
    const prettier = require("prettier");
    if (!rawJsonStr.trim()) return rawJsonStr;
    const formatted = await prettier.format(rawJsonStr, {
      parser: "json",
      tabWidth: 2,
      printWidth: 100,
    });
    return formatted.trim() + "\n";
  }

  public async prettifyJsonAndSave(
    rawJsonStr: string,
    outputPath: string,
  ): Promise<void> {
    const result = await this.prettifyJson(rawJsonStr);
    const fs = require("fs");
    const path = require("path");
    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, result, "utf-8");
  }
}
