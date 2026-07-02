/**
 * @module Converter.test
 * @description Core functionality or script runner for Converter.test.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies assert, fs, path, Converter
 * @lastUpdated 2026-06-11
 */

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { PyTorchKRConverter } from "../../../src/sites/pytorch_kr/Converter";

const converter = new PyTorchKRConverter();

function readFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

console.log("🧪 [시작] PyTorchKR Converter 단위 테스트\n");

// ── raw HTML (Discourse full page) ──────────────────────────────
(async () => {
  try {
    console.log(
      "── Discourse full HTML (server-rendered page with post content) ──",
    );

    {
      const html = readFixture("10483.html"); // Discourse full page
      const result = await converter.convertHtmlToMarkdown(
        html,
        "10483",
        "https://discuss.pytorch.kr/t/1-260-feat-anthropic/10483",
      );
      assert.ok(
        result.title.startsWith("사회과학 분야"),
        "Title should be extracted from <title>",
      );
      assert.ok(
        result.rawContent.includes("# 📂 [PyTorch KR]"),
        "Markdown should contain header",
      );
      // With htmlparser2, cheerio can parse the server-rendered HTML and extract post content
      assert.ok(
        result.content.length > 5000,
        "Content should be extracted from Discourse HTML (≥5000 chars)",
      );
      console.log(
        `✅ Discourse full HTML: title OK, content = ${result.content.length} chars`,
      );
    }

    // ── publishedAt fallback ──────────────────────────────
    console.log(
      "\n── publishedAt fallback (meta[property=article:published_time]) ──",
    );

    {
      // HTML without time[datetime] but with meta tag
      const html =
        '<html><head><meta property="article:published_time" content="2026-06-04T06:30:39+00:00"></head><body><div class="post" itemprop="text"><p>test</p></div></body></html>';
      const result = await converter.convertHtmlToMarkdown(
        html,
        "test",
        "https://example.com",
      );
      assert.strictEqual(
        result.publishedAt,
        "2026-06-04T06:30:39+00:00",
        "Should extract from meta tag when time[datetime] missing",
      );
      console.log("✅ meta[article:published_time] fallback: OK");
    }

    {
      // HTML without any time/meta
      const html =
        '<html><head></head><body><div class="post" itemprop="text"><p>test</p></div></body></html>';
      const result = await converter.convertHtmlToMarkdown(
        html,
        "test",
        "https://example.com",
      );
      assert.strictEqual(
        result.publishedAt,
        null,
        "Should be null when no date info",
      );
      console.log("✅ No date info → null: OK");
    }

    // ── JSON API 재구성 HTML ──────────────────────────────
    console.log("\n── JSON API 재구성 HTML ──");

    const testCases: {
      id: string;
      titlePrefix: string;
      minContentLen: number;
    }[] = [
      {
        id: "10483",
        titlePrefix: "사회과학 분야에 코딩 에이전트",
        minContentLen: 10000,
      },
      {
        id: "10523",
        titlePrefix: "Microsoft AI, 5개 분야 7종 MAI",
        minContentLen: 12000,
      },
      {
        id: "10492",
        titlePrefix: "Nango: AI 에이전트와 제품",
        minContentLen: 4000,
      },
    ];

    for (const tc of testCases) {
      const html = readFixture(`${tc.id}.json.html`);
      const result = await converter.convertHtmlToMarkdown(
        html,
        tc.id,
        `https://discuss.pytorch.kr/t/topic/${tc.id}`,
      );
      const expected = readFixture(`${tc.id}.expected.md`);

      assert.ok(
        result.title.startsWith(tc.titlePrefix),
        `#${tc.id}: Title should match`,
      );
      assert.ok(
        result.content.length >= tc.minContentLen,
        `#${tc.id}: Content should be substantial (≥${tc.minContentLen})`,
      );
      assert.strictEqual(
        result.rawContent.trim(),
        expected.trim(),
        `#${tc.id}: rawContent should match expected markdown`,
      );
      assert.ok(
        result.rawContent.includes("📝 본문 내용"),
        `#${tc.id}: Should contain 본문 내용 header`,
      );
      assert.ok(
        result.rawContent.includes("원본 링크"),
        `#${tc.id}: Should contain 원본 링크`,
      );
      assert.ok(
        result.publishedAt !== null,
        `#${tc.id}: publishedAt should be extracted`,
      );
      assert.ok(
        result.publishedAt!.toISOString().includes("T"),
        `#${tc.id}: publishedAt should be ISO format`,
      );
      console.log(
        `✅ #${tc.id}: ${result.title.substring(0, 40)}... (${result.content.length} chars)`,
      );
    }

    console.log(
      "\n🎉 [성공] 모든 PyTorchKR Converter 테스트가 통과되었습니다!",
    );
  } catch (e: unknown) {
    console.error(`\n❌ 테스트 실패: ${(e as Error).message}`);
    process.exit(1);
  }
})();
