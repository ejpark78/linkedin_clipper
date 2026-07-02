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
import { GeekNewsConverter } from "../../../src/sites/geeknews/Converter";

console.log("🧪 [시작] GeekNews Converter 단위 테스트\n");

const converter = new GeekNewsConverter();

function readFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

(async () => {
  try {
    // ── cleanContent ──────────────────────────────────────────────────

    console.log("── cleanContent ──");

    // 1. HTML 태그 제거
    {
      const input = '<div id="foo">Hello <b>World</b></div>';
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.strictEqual(output, "Hello World", "HTML tags should be stripped");
      console.log("✅ HTML 태그 제거");
    }

    // 2. 인라인 " - " → 마크다운 리스트 변환 (3개 이상, newline 1개 이하)
    {
      const input = "item A - item B - item C - item D";
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.ok(output.startsWith("- item A"), "Should convert to bullet list");
      assert.ok(output.includes("\n- item B"), "Second item on new line");
      assert.ok(output.includes("\n- item C"), "Third item on new line");
      assert.ok(output.match(/-/g)?.length === 4, "Should produce 4 bullets");
      console.log('✅ 인라인 "- " → 마크다운 리스트 변환');
    }

    // 3. "- " 변환 조건: 3개 미만이면 그대로
    {
      const input = "just one - two items";
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.strictEqual(
        output,
        input,
        "Less than 3 dash groups should be preserved",
      );
      console.log('✅ "- " 변환 조건: 3개 미만 보존');
    }

    // 4. "- " 변환 조건: 이미 newline 있으면 건너뛰기
    {
      const input = "a - b\nc - d\ne - f";
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.strictEqual(
        output,
        input,
        "Content with newlines should not be converted",
      );
      console.log('✅ "- " 변환 조건: newline 있으면 건너뜀');
    }

    // 5. "\\- " 언이스케이프
    {
      const input = "\\- item one\n\\- item two\n\\- item three";
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.ok(
        !output.includes("\\-"),
        "Backslash before dash at line start should be removed",
      );
      assert.ok(output.startsWith("- "), "Should start with unescaped dash");
      console.log('✅ "\\\\- " 언이스케이프');
    }

    // 6. 선행 아티클 번호 제거
    {
      const input = "* '#10345'\ncontent";
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.strictEqual(
        output,
        "content",
        "Leading article number should be stripped",
      );
      console.log("✅ 선행 아티클 번호 제거");
    }

    // 7. 리스트 마커 정규화 (* → -)
    {
      const input = "* item one\n* item two";
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.ok(
        output.startsWith("- "),
        "* should be normalized to - at line start",
      );
      assert.ok(
        output.includes("\n- "),
        "* should be normalized to - on subsequent lines",
      );
      console.log("✅ 리스트 마커 정규화 (* → -)");
    }

    // 8. 헤딩 레벨 시프트 (## → ###)
    {
      const input = "## Section\n### Sub\nContent";
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.ok(output.startsWith("### Section"), "## should become ###");
      assert.ok(output.includes("\n#### Sub"), "### should become ####");
      console.log("✅ 헤딩 레벨 시프트 (## → ###)");
    }

    // 9. 헤딩 레벨 시프트: # (h1) 은 보존
    {
      const input = "# Title\n## Section";
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.ok(output.startsWith("# Title"), "h1 should be preserved");
      assert.ok(output.includes("\n### Section"), "h2 should still shift");
      console.log("✅ 헤딩 레벨 시프트: h1 보존");
    }

    // 10. 실제 #4265 JSON-LD 스타일 입력
    {
      const input =
        "요약: - 첫째 항목입니다. 내용이 들어갑니다. - 둘째 항목입니다. 더 많은 내용. - 셋째 항목입니다. - 넷째 항목입니다.";
      const output = (
        converter as unknown as { cleanContent: (html: string) => string }
      ).cleanContent(input);
      assert.ok(output.startsWith("- 요약:"), "Should start with dash");
      assert.ok(output.includes("\n- 둘째"), "Second item on new line");
      assert.ok(output.includes("\n- 셋째"), "Third item on new line");
      assert.ok(output.includes("\n- 넷째"), "Fourth item on new line");
      console.log("✅ #4265 스타일 JSON-LD 텍스트 변환");
    }

    // ── convertHtmlToMarkdown ─────────────────────────────────────────

    console.log("\n── convertHtmlToMarkdown ──");

    // 11. #4265 전체 변환
    {
      const html = readFixture("4265.html");
      const result = await converter.convertHtmlToMarkdown(
        html,
        "4265",
        "https://news.hada.io/topic?id=4265",
      );
      const content = result.content;
      const raw = result.rawContent;

      // Title
      assert.ok(raw.includes("# 📰 Coinbase"), "Title should be present");

      // External link
      assert.ok(
        raw.includes("blog.coinbase.com"),
        "External article link should be in rawContent",
      );

      // Content section header
      assert.ok(
        raw.includes("## 📝 요약 설명"),
        "Summary header should be present",
      );

      // 정답 MD 파일과 비교
      assert.strictEqual(
        raw,
        readFixture("4265.expected.md"),
        "rawContent should match 4265.expected.md",
      );

      // Comments
      assert.ok(result.comments.length > 0, "Comments should be extracted");

      // No HTML tags leaked
      assert.ok(!content.includes("<div"), "No HTML div tags in content");
      assert.ok(!content.includes("class="), "No class attributes in content");
      assert.ok(
        !content.includes('id="'),
        'No id=" in content (HTML attributes)',
      );

      // Bullet format validation
      const bulletLines = content
        .split("\n")
        .filter((l: string) => l.startsWith("- "));
      assert.ok(bulletLines.length >= 10, "Should have many bullet points");

      console.log(`✅ #4265 전체 변환 (${bulletLines.length} bullet points)`);
    }

    // 12. #5299 변환 (정답 MD 비교)
    {
      const html = readFixture("5299.html");
      const result = await converter.convertHtmlToMarkdown(
        html,
        "5299",
        "https://news.hada.io/topic?id=5299",
      );
      const expected = readFixture("5299.expected.md");
      assert.strictEqual(
        result.rawContent,
        expected,
        "rawContent should match 5299.expected.md",
      );

      console.log(`✅ #5299 변환 (content length: ${result.content.length})`);
    }

    // 13. #1069 변환 (정답 MD 비교)
    {
      const html = readFixture("1069.html");
      const result = await converter.convertHtmlToMarkdown(
        html,
        "1069",
        "https://news.hada.io/topic?id=1069",
      );
      const expected = readFixture("1069.expected.md");
      assert.strictEqual(
        result.rawContent,
        expected,
        "rawContent should match 1069.expected.md",
      );

      console.log(`✅ #1069 변환 (content length: ${result.content.length})`);
    }

    // 14. #2994 변환 (정답 MD 비교)
    {
      const html = readFixture("2994.html");
      const result = await converter.convertHtmlToMarkdown(
        html,
        "2994",
        "https://news.hada.io/topic?id=2994",
      );
      const expected = readFixture("2994.expected.md");
      assert.strictEqual(
        result.rawContent,
        expected,
        "rawContent should match 2994.expected.md",
      );

      console.log(`✅ #2994 변환 (content length: ${result.content.length})`);
    }

    // ── Viewer cleanMarkdownContent (로직 복제) ────────────────────────

    console.log("\n── Viewer cleanMarkdownContent 로직 ──");

    function cleanMarkdownContent(mdContent: string): string {
      if (!mdContent) return "";
      let cleaned = mdContent.trim();
      if (cleaned.startsWith("---")) {
        const nextDashes = cleaned.indexOf("---", 3);
        if (nextDashes !== -1)
          cleaned = cleaned.substring(nextDashes + 3).trim();
      }
      const jdMatch = cleaned.match(/## 📝 JD/i);
      if (jdMatch) {
        const jdIndex = cleaned.indexOf(jdMatch[0]);
        cleaned = cleaned.substring(jdIndex).trim();
      }
      const commentMatch = cleaned.match(
        /## 💬 댓글|## 💬 Discussion|## 💬 Comments/i,
      );
      if (commentMatch) {
        const commentIndex = cleaned.indexOf(commentMatch[0]);
        cleaned = cleaned.substring(0, commentIndex).trim();
      }
      return cleaned;
    }

    // 15. Viewer: 댓글 섹션 제거
    {
      const md =
        "# Title\n\nContent here\n\n## 💬 댓글 및 토론 (3개)\n### 👤 user\n> comment";
      const cleaned = cleanMarkdownContent(md);
      assert.ok(cleaned.includes("Content here"), "Content should be kept");
      assert.ok(
        !cleaned.includes("💬 댓글"),
        "Comments section should be stripped",
      );
      assert.ok(
        !cleaned.includes("👤 user"),
        "Comment authors should be stripped",
      );
      assert.ok(
        !cleaned.includes("> comment"),
        "Comment text should be stripped",
      );
      console.log("✅ Viewer: 댓글 섹션 제거");
    }

    // 16. Viewer: LinkedIn JD 추출
    {
      const md =
        "## 🏢 info\nsome text\n## 📝 JD\nactual job description\nmore details";
      const cleaned = cleanMarkdownContent(md);
      assert.ok(cleaned.startsWith("## 📝 JD"), "Should start with JD section");
      assert.ok(
        cleaned.includes("actual job description"),
        "JD content should be kept",
      );
      assert.ok(!cleaned.includes("info"), "Info section should be removed");
      console.log("✅ Viewer: LinkedIn JD 추출");
    }

    // 17. Viewer: YAML frontmatter 제거
    {
      const md = "---\ntitle: Test\n---\n\nActual content";
      const cleaned = cleanMarkdownContent(md);
      assert.ok(
        !cleaned.includes("title: Test"),
        "Frontmatter should be stripped",
      );
      assert.ok(
        cleaned.includes("Actual content"),
        "Content after frontmatter should be kept",
      );
      console.log("✅ Viewer: YAML frontmatter 제거");
    }

    // ── meta table 생성 ───────────────────────────────────────────────

    console.log("\n── generateMetaTableMarkdown 로직 ──");

    function generateMetaTableMarkdown(
      silver: Record<string, unknown>,
      bronze: Record<string, unknown>,
      collection: string,
    ): string {
      const rows: string[] = [];
      const title =
        (silver.title as string) || (silver.jobTitle as string) || "";
      if (title) rows.push(`| **Title (제목)** | ${title} |`);
      const company = (silver.companyName as string) || "";
      if (company) rows.push(`| **Company (회사)** | ${company} |`);
      const loc = (silver.location as string) || "";
      if (loc) rows.push(`| **Location (위치)** | ${loc} |`);
      const docId =
        (silver.jobId as string) ||
        (silver.id as string) ||
        (silver.topicId as string) ||
        (silver.postId as string) ||
        (bronze.jobId as string) ||
        "";
      if (docId) rows.push(`| **Document ID** | \`${docId}\` |`);
      let source = "Database";
      if (collection.includes("geeknews")) source = "GeekNews";
      else if (collection.includes("linkedin")) source = "LinkedIn";
      rows.push(`| **Source (출처)** | ${source} (\`${collection}\`) |`);
      const url = (bronze.url as string) || (silver.url as string) || "";
      if (url) rows.push(`| **URL** | [Link ↗](${url}) |`);
      const dateVal =
        silver.updatedAt ||
        silver.collectedAt ||
        silver.createdAt ||
        bronze.scrapedAt;
      if (dateVal)
        rows.push(
          `| **Date (수집일)** | ${new Date(dateVal as string | number | Date).toLocaleString("ko-KR")} |`,
        );
      if (rows.length === 0) return "";
      return `\n\n---\n\n### 📋 LLM Wiki Metadata\n\n| Key (속성) | Value (값) |\n| :--- | :--- |\n${rows.join("\n")}\n`;
    }

    // 18. Meta table with GeekNews data
    {
      const silver = {
        title: "Test Article",
        id: "4265",
        updatedAt: new Date("2026-06-08"),
      };
      const bronze = { url: "https://news.hada.io/topic?id=4265" };
      const table = generateMetaTableMarkdown(
        silver,
        bronze,
        "silver/geeknews.contents",
      );
      assert.ok(table.includes("GeekNews"), "Source should be GeekNews");
      assert.ok(table.includes("Test Article"), "Title should be in table");
      assert.ok(table.includes("4265"), "Document ID should be in table");
      assert.ok(table.includes("news.hada.io"), "URL should be in table");
      console.log("✅ Meta table: GeekNews 데이터");
    }

    console.log("\n🎉 [성공] 모든 GeekNews Converter 테스트가 통과되었습니다!");
    process.exit(0);
  } catch (error: unknown) {
    console.error(`\n❌ 테스트 실패: ${(error as Error).message}`);
    console.error((error as Error).stack);
    process.exit(1);
  }
})();
