/**
 * @file HtmlDebugger.ts
 * @description Utility class for parsing and debugging HTML structures, JSON-LD schemas, and text densities.
 *
 * Rules Complied:
 * - Strict OOP Patterns: Implements helper methods in a class structure.
 * - Strict Typing: Avoids loose any type where possible, defines interfaces.
 * - Agent-Friendly Docstrings: Header documentation present.
 */

import * as cheerio from "cheerio";

export interface SelectorAnalysis {
  selector: string;
  count: number;
  textLength: number;
  preview: string;
}

export interface LargeElementInfo {
  tag: string;
  id: string;
  className: string;
  textLength: number;
  preview: string;
}

export class HtmlDebugger {
  /**
   * Find and parse JSON-LD objects from HTML content.
   */
  public static findJsonLd(
    html: string,
    typeFilter?: string,
  ): Record<string, any>[] {
    const $ = cheerio.load(html);
    const results: Record<string, any>[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      const text = $(el).html();
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (!typeFilter || item["@type"] === typeFilter) {
              results.push(item);
            }
          }
        } else {
          if (!typeFilter || parsed["@type"] === typeFilter) {
            results.push(parsed);
          }
        }
      } catch {}
    });

    return results;
  }

  /**
   * Analyze presence, counts, and text properties of key DOM selectors.
   */
  public static analyzeSelectors(
    html: string,
    selectors: string[],
  ): SelectorAnalysis[] {
    const $ = cheerio.load(html);
    return selectors.map((selector) => {
      const el = $(selector);
      const text = el.text().trim();
      return {
        selector,
        count: el.length,
        textLength: text.length,
        preview: text.length > 0 ? text.substring(0, 150) + "..." : "",
      };
    });
  }

  /**
   * Locate DOM elements that directly contain high density of text.
   */
  public static findLargeTextElements(
    html: string,
    minLength: number = 200,
  ): LargeElementInfo[] {
    const $ = cheerio.load(html);
    const results: LargeElementInfo[] = [];

    $("*").each((_, el) => {
      const cheerioEl = $(el);
      // Retrieve text directly belonging to the node itself (ignoring child text to avoid repeating parent divs)
      const directText = cheerioEl
        .clone()
        .children()
        .remove()
        .end()
        .text()
        .trim();
      if (directText.length >= minLength) {
        results.push({
          tag: (el as any).name || "",
          id: cheerioEl.attr("id") || "",
          className: cheerioEl.attr("class") || "",
          textLength: directText.length,
          preview: directText.substring(0, 100) + "...",
        });
      }
    });

    return results;
  }

  /**
   * Print a detailed analysis report to console.
   */
  public static printAnalysisReport(
    html: string,
    targetSelectors: string[] = [],
  ): void {
    console.log("--- 📋 HTML Structure & Schema Analysis Report ---");

    // 1. JSON-LD Analysis
    console.log("\n[1] Schema (JSON-LD) Check:");
    const allLds = this.findJsonLd(html);
    console.log(`Found ${allLds.length} JSON-LD objects.`);
    allLds.forEach((ld, idx) => {
      console.log(
        `  (${idx + 1}) @type: "${ld["@type"] || "unknown"}", keys: [${Object.keys(ld).join(", ")}]`,
      );
      if (ld["@type"] === "NewsArticle" && ld.articleBody) {
        console.log(
          `      * NewsArticle body length: ${ld.articleBody.length} chars`,
        );
      }
    });

    // 2. Selectors Analysis
    const selectorsToCheck =
      targetSelectors.length > 0
        ? targetSelectors
        : [
            "main",
            "article",
            ".typo-contents16",
            '[data-id="detail-contents"]',
            'main[data-id="detail-contents"]',
            ".content",
            "#content",
          ];
    console.log("\n[2] DOM Target Selectors Check:");
    const selectorReports = this.analyzeSelectors(html, selectorsToCheck);
    for (const report of selectorReports) {
      console.log(
        `  Selector "${report.selector}": count = ${report.count}, text length = ${report.textLength}`,
      );
      if (report.count > 0 && report.textLength > 0) {
        console.log(`    Preview: ${report.preview}`);
      }
    }

    // 3. Dense Text Density analysis
    console.log("\n[3] Dense Text Elements Density Check:");
    const denseElements = this.findLargeTextElements(html, 200);
    denseElements.slice(0, 15).forEach((el, idx) => {
      console.log(
        `  (${idx + 1}) <${el.tag} id="${el.id}" class="${el.className}"> - Text size: ${el.textLength}`,
      );
      console.log(`      Text: ${el.preview}`);
    });
    if (denseElements.length > 15) {
      console.log(
        `  ... and ${denseElements.length - 15} more text-dense elements.`,
      );
    }
    console.log("\n------------------------------------------------");
  }
}
