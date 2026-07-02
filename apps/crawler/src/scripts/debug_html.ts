/**
 * @file debug_html.ts
 * @description Generic CLI tool to run the HtmlDebugger on any HTML file or MongoDB article.
 *
 * Usage options:
 *   1. Analyze local file:
 *      npx ts-node src/scripts/debug_html.ts --file tests/sites/yozm/fixtures/3800.html
 *   2. Analyze MongoDB document directly:
 *      npx ts-node src/scripts/debug_html.ts --site yozm --id 3800
 */

import { MongoDatabase } from "../database/mongo";
import { getSite } from "../core/SiteRegistry";
import { HtmlDebugger } from "../utils/HtmlDebugger";
import * as fs from "fs";
import * as path from "path";

function parseArgs(): { file?: string; site?: string; id?: string } {
  let file: string | undefined = undefined;
  let site: string | undefined = undefined;
  let id: string | undefined = undefined;

  const args = process.argv;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--file") {
      file = args[i + 1];
    } else if (args[i] === "--site") {
      site = args[i + 1];
    } else if (args[i] === "--id") {
      id = args[i + 1];
    }
  }
  return { file, site, id };
}

async function main() {
  const { file, site, id } = parseArgs();

  if (file) {
    const absPath = path.isAbsolute(file)
      ? file
      : path.resolve(process.cwd(), file);
    if (!fs.existsSync(absPath)) {
      console.error(`❌ Error: File "${file}" does not exist.`);
      process.exit(1);
    }
    console.log(
      `🔍 Reading and analyzing file: [${path.basename(file)}](file://${absPath})`,
    );
    const html = fs.readFileSync(absPath, "utf-8");
    HtmlDebugger.printAnalysisReport(html);
    return;
  }

  if (site && id) {
    const descriptor = getSite(site);
    if (!descriptor) {
      console.error(`❌ Error: Site "${site}" not found in registry.`);
      process.exit(1);
    }

    const db = MongoDatabase.getInstance();
    try {
      console.log(`🔌 Connecting to MongoDB...`);
      const collectionName = descriptor.scraper?.collectionName;
      if (!collectionName) {
        console.error(
          `❌ Error: Site "${site}" does not have scraper collection configured.`,
        );
        return;
      }

      const col = await db.getCollection(collectionName);
      const filterKey = descriptor.scraper?.updateFilterKey || "id";

      console.log(
        `🔍 Fetching article from "${collectionName}" where ${filterKey} = "${id}"...`,
      );
      const doc = await col.findOne({ [filterKey]: id });

      if (!doc) {
        console.error(`❌ Error: Document not found.`);
        return;
      }

      const htmlContent =
        doc.html || doc.htmlContent || doc.content || doc.rawHtml || doc.body;
      if (!htmlContent) {
        console.error(`❌ Error: No HTML content found in document.`);
        return;
      }

      console.log(`📊 Loaded HTML size: ${htmlContent.length} bytes.`);
      HtmlDebugger.printAnalysisReport(htmlContent);
    } catch (e) {
      console.error("❌ Error reading database document:", e);
    } finally {
      await db.close();
    }
    return;
  }

  console.error("❌ Error: Missing parameters.");
  console.log(
    "Usage (File): npx ts-node src/scripts/debug_html.ts --file <path_to_html>",
  );
  console.log(
    "Usage (MongoDB): npx ts-node src/scripts/debug_html.ts --site <siteKey> --id <articleId>",
  );
  process.exit(1);
}

main();
