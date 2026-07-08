/**
 * @module HtmlMinifier
 * @description Core functionality or script runner for HtmlMinifier.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies cheerio, prettier
 * @lastUpdated 2026-06-11
 */

import * as cheerio from "cheerio";
import * as prettier from "prettier";

export interface HtmlMinifierOptions {
  preserveJsonLd?: boolean;
  extraAttributes?: string[];
}

export class HtmlMinifier {
  public static async minify(
    html: string,
    options?: HtmlMinifierOptions,
  ): Promise<string> {
    try {
      const $ = cheerio.load(html);

      if (options?.preserveJsonLd) {
        $('script:not([type="application/ld+json"])').remove();
      } else {
        $("script").remove();
      }

      $("style").remove();
      $("svg").remove();
      $("img").remove();
      $("iframe").remove();
      $("noscript").remove();
      $('link[rel="stylesheet"]').remove();
      $('link[type="text/css"]').remove();
      $("header").remove();
      $("footer").remove();
      $("nav").remove();

      const allowedAttributes = new Set([
        "id",
        "class",
        "href",
        "name",
        "content",
        "property",
        "rel",
        ...(options?.preserveJsonLd ? ["type"] : []),
        ...(options?.extraAttributes || []),
      ]);

      $("*").each((_, el) => {
        const $el = $(el);
        const attribs = $el.attr();
        if (attribs) {
          for (const attr in attribs) {
            if (!allowedAttributes.has(attr.toLowerCase())) {
              $el.removeAttr(attr);
            }
          }
        }
      });

      const rawCleaned = $.html().replace(/<!--[\s\S]*?-->/g, "");

      const prettified = await prettier.format(rawCleaned, {
        parser: "html",
        printWidth: 120,
        tabWidth: 2,
      });

      return prettified;
    } catch {
      return html;
    }
  }
}
