/**
 * @module Converter.test
 * @description Core functionality or script runner for Converter.test.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies assert, fs, path, Converter, crypto
 * @lastUpdated 2026-06-11
 */

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as cheerio from "cheerio";
import { MailyJoshConverter } from "../../../../src/sites/maily/josh/Converter";

console.log("🧪 [시작] MailyJosh Converter 단위 테스트\n");

const converter = new MailyJoshConverter();

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

const TEST_URL = "https://maily.so/josh/posts/d5ryw34jz1w";
const TEST_ID = crypto.createHash("md5").update(TEST_URL).digest("hex");

(async () => {
  try {
    // ── Pagination List Parsing ─────────────────────────────────────────
    console.log("📋 [Test] Pagination List Parsing (page 1)");
    const listHtml = loadFixture("list.html");
    const $ = cheerio.load(listHtml);

    const seenUrls = new Set<string>();
    const articleLinks: Array<{ url: string; title: string }> = [];

    $('a.post-card-list-item[href*="/josh/posts/"]').each(
      (_: number, el: any) => {
        const href = $(el).attr("href");
        if (!href) return;
        const fullUrl = href.startsWith("http")
          ? href
          : `https://maily.so${href}`;

        if (seenUrls.has(fullUrl)) return;
        seenUrls.add(fullUrl);

        const titleEl = $(el).find(".font-bold").first();
        const title = titleEl.text().trim();
        if (title) {
          articleLinks.push({ url: fullUrl, title });
        }
      },
    );

    assert.ok(articleLinks.length > 0, "페이지에서 아티클 링크를 찾아야 함");
    assert.strictEqual(
      articleLinks.length,
      10,
      "페이지 1에 10개의 유니크한 링크",
    );

    const first = articleLinks[0];
    assert.ok(
      first.url.startsWith("https://maily.so/josh/posts/"),
      "URL이 post 패턴",
    );
    assert.ok(first.title.length > 0, "타이틀이 비어있지 않음");
    assert.ok(
      articleLinks.some((l) => l.url.includes("d5ryw34jz1w")),
      "최신 아티클 포함",
    );

    console.log(`  ✅ 리스트 파싱 성공: ${articleLinks.length}개 아티클`);
    console.log(`     첫 번째: "${articleLinks[0].title.substring(0, 30)}..."`);

    // ── HTML → Markdown 변환 ────────────────────────────────────────────
    console.log("\n📝 [Test] HTML to Markdown Conversion");
    const html = loadFixture("article.html");
    const result = await converter.convertHtmlToMarkdown(
      html,
      TEST_ID,
      TEST_URL,
    );

    assert.strictEqual(result.id, TEST_ID, "ID가 MD5 해시와 일치");
    assert.ok(
      result.title.includes("코드를 손으로 안 치는 창업자"),
      "제목 추출",
    );
    assert.strictEqual(result.url, TEST_URL, "URL 일치");
    assert.strictEqual(
      result.publishedAt,
      "2026-06-10T00:00:00Z",
      "발행일 추출",
    );
    assert.strictEqual(result.category, "비즈니스 인사이트", "카테고리 추출");
    assert.ok(
      result.viewCount !== null && result.viewCount.length > 0,
      "조회수 추출",
    );
    assert.ok(result.content.length > 0, "컨텐츠가 비어있지 않음");
    assert.ok(
      result.content.includes("찰리 홀츠는"),
      "컨텐츠에 본문 텍스트 포함",
    );
    assert.ok(
      result.content.includes("Conductor"),
      "컨텐츠에 주요 키워드 포함",
    );

    assert.ok(result.rawContent.includes("# "), "rawContent에 헤더 포함");
    assert.ok(
      result.rawContent.includes("카테고리:"),
      "rawContent에 카테고리 포함",
    );
    assert.ok(
      result.rawContent.includes("발행일:"),
      "rawContent에 발행일 포함",
    );
    assert.ok(
      result.rawContent.includes("원본 링크:"),
      "rawContent에 원본 링크 포함",
    );

    console.log(`  ✅ HTML 변환 성공: ${result.title.substring(0, 40)}...`);
    console.log(`     - 컨텐츠 길이: ${result.content.length} chars`);
    console.log(`     - rawMarkdown: ${result.rawContent.length} chars`);

    console.log("\n========================================");
    console.log("🎉 모든 테스트 통과!");
    console.log("========================================");
  } catch (e: unknown) {
    console.error(`\n❌ 테스트 실패: ${(e as Error).message}`);
    process.exit(1);
  }
})();
