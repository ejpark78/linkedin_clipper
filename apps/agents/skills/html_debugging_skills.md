# Skill: HTML Crawler & Parser Debugging

This document defines the skills and CLI instructions for analyzing crawler logs and debugging HTML parsers and converters.

---

## 1. 🔍 Error & Container Log Analysis

Quickly filter and audit error stacks from runtime container logs.

### 1.1 Running `grep-errors`
Parse and audit error logs and converter failures across containers:
```bash
docker compose -p scraper logs --no-color scraper converter | \
  docker compose -p scraper run --rm -T \
  -v ./src/scripts:/app/src/scripts \
  worker npx ts-node src/scripts/grep-errors.ts
```
*(References: [grep-errors.ts](src/scripts/grep-errors.ts) CLI error aggregator)*

- This command calculates statistics and identifies which site keys and document IDs have high frequencies of conversion failures (`Conversion failed`) or crawl failures.

---

## 2. 🛠️ Parser Verification Using `debug_html.ts`

When body text is missing or Turndown conversion results are corrupted, use the `HtmlDebugger` to inspect hierarchical tag analysis.

### 2.1 Analyzing a Local HTML Test File
Analyze test fixtures or manually saved HTML files to inspect valid tags and content candidates:
```bash
docker compose -p scraper run --rm \
  -v $(pwd):/app -v /app/node_modules \
  worker npx ts-node src/scripts/debug_html.ts --file tests/sites/yozm/fixtures/article.html
```
*(References: [debug_html.ts](src/scripts/debug_html.ts) CLI runner)*

### 2.2 Directly Debugging a MongoDB Document
Run debugging analysis on a document already stored in the `bronze` database:
```bash
docker compose -p scraper run --rm \
  -v $(pwd):/app -v /app/node_modules \
  worker npx ts-node src/scripts/debug_html.ts --site yozm --id 3800
```
- When executed, this command outputs the HTML file size, structural analysis results, and high-priority DOM elements (such as JSON-LD, meta tags, etc.) to help fine-tune parsing rules.
