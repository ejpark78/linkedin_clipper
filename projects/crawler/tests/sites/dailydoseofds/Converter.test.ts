/**
 * @module Converter.test
 * @description Core functionality or script runner for Converter.test.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies assert, fs, path, cheerio, turndown
 * @lastUpdated 2026-06-11
 */

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { DailyDoseDSConverter } from "../../../src/sites/dailydoseofds/Converter";

const converter = new DailyDoseDSConverter();

function readFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

console.log("🧪 [시작] DailyDoseDS Converter 단위 테스트\n");

// 1. Archive Page Structure Test (List extraction simulation)
console.log("── Archive Page List Test ──");
{
  const html = readFixture("archive.html");
  const $ = cheerio.load(html);
  const posts = $("article").toArray();
  assert.ok(posts.length > 0, "Should find at least one article in archive");
  const firstLink = $(posts[0]).find("a").attr("href");
  assert.ok(firstLink && firstLink.includes("/"), "Should extract a valid URL");
  console.log(`✅ Archive list: Found ${posts.length} posts`);
}

// 2. Detailed Page Conversion Tests
const testCases = [
  {
    file: "course_7.html",
    url: "https://www.dailydoseofds.com/rl-course-part-7/",
    titleKey: "Policy Gradients",
    expectedFile: "course_7.expected.md",
  },
  {
    file: "hermes.html",
    url: "https://www.dailydoseofds.com/p/hermes-agent-masterclass/",
    titleKey: "Hermes Agent",
    expectedFile: "hermes.expected.md",
  },
  {
    file: "speculative.html",
    url: "https://www.dailydoseofds.com/p/speculative-decoding-in-llms/",
    titleKey: "Speculative Decoding",
    expectedFile: "speculative.expected.md",
  },
  {
    file: "course_6.html",
    url: "https://www.dailydoseofds.com/rl-course-part-6/",
    titleKey: "Introduction to Deep RL",
    expectedFile: "course_6.expected.md",
  },
];

(async () => {
  for (let idx = 0; idx < testCases.length; idx++) {
    const tc = testCases[idx];
    console.log(`\n── Case ${idx + 1}: ${tc.file} ──`);
    const html = readFixture(tc.file);
    const result = await converter.convertHtmlToMarkdown(
      html,
      `test-${idx}`,
      tc.url,
    );
    const expected = readFixture(tc.expectedFile);

    assert.strictEqual(
      result.rawContent.trim(),
      expected.trim(),
      `rawContent should match expected markdown for ${tc.file}`,
    );
    assert.ok(
      result.title.includes(tc.titleKey),
      `Title should contain ${tc.titleKey}`,
    );
    assert.ok(result.content.length > 100, "Content should be substantial");
    assert.ok(
      result.rawContent.includes("## 📝 본문 내용"),
      "Should contain the content header",
    );
    console.log(`✅ Success: ${result.title} (${result.content.length} chars)`);
  }

  console.log("\n🎉 [성공] 모든 DailyDoseDS 테스트가 통과되었습니다!");
})();
