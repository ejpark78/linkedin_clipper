/**
 * @file extract_article.ts
 * @description Generic CLI tool to extract any article's HTML from MongoDB and generate expected markdown using configured site converter.
 *
 * Usage: npx ts-node src/scripts/extract_article.ts --site <siteKey> --id <articleId>
 */

import { MongoDatabase } from "../database/mongo";
import { getSite } from "../core/SiteRegistry";
import * as fs from "fs";
import * as path from "path";

function parseArgs(): { site: string; id: string } {
  let site = "";
  let id = "";
  const args = process.argv;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--site") {
      site = args[i + 1] || "";
    } else if (args[i] === "--id") {
      id = args[i + 1] || "";
    }
  }
  return { site, id };
}

async function main() {
  const { site, id } = parseArgs();
  if (!site || !id) {
    console.error("❌ Error: Missing parameters.");
    console.log(
      "Usage: npx ts-node src/scripts/extract_article.ts --site <siteKey> --id <articleId>",
    );
    process.exit(1);
  }

  const descriptor = getSite(site);
  if (!descriptor) {
    console.error(`❌ Error: Site "${site}" not found in registry.`);
    process.exit(1);
  }

  const db = MongoDatabase.getInstance();
  try {
    console.log(`🔌 Connecting to MongoDB...`);
    const bronzeCollectionName = descriptor.scraper?.collectionName;
    if (!bronzeCollectionName) {
      console.error(
        `❌ Error: Site "${site}" does not have scraper collection configured.`,
      );
      return;
    }

    const col = await db.getCollection(bronzeCollectionName);
    const filterKey = descriptor.scraper?.updateFilterKey || "id";

    console.log(
      `🔍 Finding article in "${bronzeCollectionName}" where ${filterKey} = "${id}"...`,
    );
    const doc = await col.findOne({ [filterKey]: id });

    if (!doc) {
      console.error(`❌ Error: Document not found.`);
      return;
    }

    const htmlContent =
      doc.html || doc.htmlContent || doc.content || doc.rawHtml || doc.body;
    if (!htmlContent) {
      console.error(
        `❌ Error: No HTML content field found in MongoDB document.`,
      );
      return;
    }

    const fixturesDir = path.join(
      __dirname,
      `../../tests/sites/${site}/fixtures`,
    );
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    const htmlPath = path.join(fixturesDir, `${id}.html`);
    fs.writeFileSync(htmlPath, htmlContent, "utf-8");
    console.log(`💾 Saved HTML to: [${id}.html](file://${htmlPath})`);

    const converter = descriptor.converter?.converter;
    if (!converter) {
      console.warn(
        `⚠️ Warning: No converter registered for site "${site}". Skipping Markdown generation.`,
      );
      return;
    }

    console.log(`⚙️ Running converter for "${site}"...`);
    const result: any = await converter.convertHtmlToMarkdown(
      htmlContent,
      id,
      doc.url || "",
    );

    const mdPath = path.join(fixturesDir, `${id}.expected.md`);
    if (typeof converter.prettifyAndSave === "function") {
      await converter.prettifyAndSave(result.rawContent, mdPath);
      console.log(`💾 Saved MD to: [${id}.expected.md](file://${mdPath})`);
    } else {
      console.warn(
        `⚠️ Warning: Converter for "${site}" does not support prettifyAndSave.`,
      );
    }
    console.log(
      `📊 Markdown Content Length: ${result.content.length} characters.`,
    );
  } catch (error) {
    console.error("❌ Unexpected error running extractor:", error);
  } finally {
    await db.close();
  }
}

main();
