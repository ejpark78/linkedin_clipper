/**
 * @module BaseConverter
 * @description Abstract base class implementing common markdown conversion and formatting logic.
 *
 * Rules Complied:
 * - OOP: Inherits from IConverter and IFileSaver.
 * - DRY: Centralizes prettify, prettifyAndSave, and default htmlToMarkdown operations.
 * - Strict Typing: Uses generics and explicitly types options.
 */

import { IConverter, IFileSaver } from "./IConverter";
import * as prettier from "prettier";
import * as fs from "fs";
import * as path from "path";

export abstract class BaseConverter<T> implements IConverter<T>, IFileSaver {
  /**
   * HTML 내용을 파싱하여 특정 메타데이터 오브젝트 T를 생성합니다.
   */
  public abstract convertHtmlToMarkdown(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<T>;

  /**
   * 마크다운 텍스트 포맷팅을 수행합니다.
   */
  public async prettify(rawText: string): Promise<string> {
    const formatted = await prettier.format(rawText, {
      parser: "markdown",
      proseWrap: "preserve",
      tabWidth: 2,
      printWidth: 100,
    });
    return formatted.trim() + "\n";
  }

  /**
   * 마크다운을 Prettify하여 지정된 경로에 저장합니다.
   */
  public async prettifyAndSave(
    rawText: string,
    outputPath: string,
  ): Promise<void> {
    const result = await this.prettify(rawText);
    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, result, "utf-8");
  }

  /**
   * HTML을 마크다운으로 변환하는 기본 헬퍼 메소드
   */
  protected htmlToMarkdown(html: string): string {
    try {
      const TurndownService = require("turndown");
      const turndownService = new TurndownService({
        headingStyle: "atx",
        hr: "---",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        emDelimiter: "*",
      });

      // 공통 불필요 태그 제거
      turndownService.remove([
        "script",
        "style",
        "nav",
        "iframe",
        "noscript",
        "button",
        "select",
        "textarea",
        "form",
      ]);

      let markdown = turndownService.turndown(html);
      // 다중 줄바꿈 압축
      markdown = markdown.replace(/\n\s*\n\s*\n/g, "\n\n");
      return markdown.trim();
    } catch {
      const cheerio = require("cheerio");
      const $ = cheerio.load(html);
      return $.text().trim();
    }
  }
}
