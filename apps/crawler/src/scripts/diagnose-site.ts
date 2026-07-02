/**
 * @file diagnose-site.ts
 * @description Command-line utility to diagnose database consistency, duplicate entries, URL encoding/normalization
 *              mismatches, and Bronze-to-Silver lifecycle issues for a specific scraper site.
 * @constraints
 *   - Runs inside the Docker environment.
 *   - Follows strict TypeScript typing and connection lifecycle rules.
 * @dependencies MongoDatabase, SiteRegistry, MeiliSearchDatabase
 */

import { MongoDatabase } from "../database/mongo";
import { getAllSites, getIndexName } from "../core/SiteRegistry";
import { MeiliSearchDatabase } from "../database/meili";
import crypto from "crypto";

function printHelp() {
  console.log(`
🛸 Site Data Integrity Diagnostics Tool
Usage:
  npx ts-node src/scripts/diagnose-site.ts --site <site_key> [--limit <number>]

Options:
  --site   (Required) The site key to diagnose (e.g. uppity, geeknews, gpters)
  --limit  (Optional) Limit of duplicate groups to analyze (default: 5)
  --help   Show this help screen
`);
}

async function main() {
  const args = process.argv.slice(2);
  const siteArgIndex = args.indexOf("--site");
  const limitArgIndex = args.indexOf("--limit");
  const helpActive = args.includes("--help") || args.includes("-h");

  if (helpActive || siteArgIndex === -1 || siteArgIndex + 1 >= args.length) {
    printHelp();
    process.exit(helpActive ? 0 : 1);
  }

  const siteKey = args[siteArgIndex + 1];
  const limit =
    limitArgIndex !== -1 && limitArgIndex + 1 < args.length
      ? parseInt(args[limitArgIndex + 1], 10)
      : 5;

  // Resolve site collections
  const sites = getAllSites();
  const siteDesc = sites.find((s) => s.key === siteKey);
  if (!siteDesc) {
    console.error(`❌ Error: Site descriptor not found for key "${siteKey}"`);
    console.log(`Available sites: ${sites.map((s) => s.key).join(", ")}`);
    process.exit(1);
  }

  const sContentsColName =
    siteDesc.targetLoader?.collectionName || `silver/${siteKey}.contents`;
  const bUrlsColName =
    siteDesc.scraper?.urlsCollectionName || `bronze/${siteKey}.urls`;
  const bHtmlColName =
    siteDesc.scraper?.collectionName || `bronze/${siteKey}.html`;

  console.log(`🛸 Diagnosing Site: "${siteDesc.name}" (${siteKey})`);
  console.log(`- Silver Contents: ${sContentsColName}`);
  console.log(`- Bronze URLs:     ${bUrlsColName}`);
  console.log(`- Bronze HTML:     ${bHtmlColName}\n`);

  const mongo = MongoDatabase.getInstance();
  const meili = MeiliSearchDatabase.getInstance();
  try {
    await mongo.connect();
    const bUrls = await mongo.getCollection(bUrlsColName as any);
    const bHtml = await mongo.getCollection(bHtmlColName as any);
    const sContents = await mongo.getCollection(sContentsColName as any);

    console.log("📊 1. Document Counts");
    const totalSilver = await sContents.countDocuments();
    const totalBronzeUrls = await bUrls.countDocuments();
    const totalBronzeHtml = await bHtml.countDocuments();
    console.log(`- Silver documents: ${totalSilver}`);
    console.log(`- Bronze URL entries: ${totalBronzeUrls}`);
    console.log(`- Bronze HTML entries: ${totalBronzeHtml}\n`);

    console.log("🔍 2. Identifying Duplicates in Silver layer (by Title)...");
    const dupes = await sContents
      .aggregate([
        {
          $group: {
            _id: "$title",
            count: { $sum: 1 },
            docs: { $push: "$$ROOT" },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $limit: limit },
      ])
      .toArray();

    if (dupes.length === 0) {
      console.log(
        "✅ No duplicate document titles found in the Silver layer.\n",
      );
    } else {
      console.log(
        `⚠️ Found duplicate titles. Displaying top ${dupes.length} groups:\n`,
      );

      for (let i = 0; i < dupes.length; i++) {
        const group = dupes[i];
        console.log(
          `--------------------------------------------------------------------------------`,
        );
        console.log(
          `Group #${i + 1}: Title = "${group._id}" (${group.count} occurrences)`,
        );
        console.log(
          `--------------------------------------------------------------------------------`,
        );

        for (const doc of group.docs) {
          const id = doc.id;
          const url = doc.url || "";
          const urlHex = Buffer.from(url).toString("hex");
          const hasUrlsRecord = (await bUrls.findOne({ id }))
            ? "✅ YES"
            : "❌ NO";
          const hasHtmlRecord = (await bHtml.findOne({ id }))
            ? "✅ YES"
            : "❌ NO";
          const isPercentEncoded = url.includes("%")
            ? "⚠️ YES (Encoded)"
            : "✅ NO (Decoded)";

          let expectedId = "N/A";
          if (siteDesc.scraper?.extractId) {
            expectedId = siteDesc.scraper.extractId(url);
          } else {
            expectedId = crypto.createHash("md5").update(url).digest("hex");
          }
          const idMatch =
            id === expectedId
              ? "✅ Match"
              : `❌ Mismatch (Expected: ${expectedId})`;

          console.log(`  * ID:  ${id} [${idMatch}]`);
          console.log(`    URL: ${url}`);
          console.log(`    URL Hex:  ${urlHex}`);
          console.log(`    Encoding: ${isPercentEncoded}`);
          console.log(
            `    In Bronze.urls: ${hasUrlsRecord} | In Bronze.html: ${hasHtmlRecord}`,
          );
          console.log("");
        }
      }
    }

    // 3. Check for invalid or empty values in key fields
    console.log("🧹 3. Integrity Check for Null / Empty Values (Silver)");
    const emptyTitles = await sContents.countDocuments({
      title: { $in: [null, "", "Untitled"] },
    });
    const emptyUrls = await sContents.countDocuments({
      url: { $in: [null, ""] },
    });
    const emptyContent = await sContents.countDocuments({
      $or: [{ content: null }, { markdown: null }],
    });

    console.log(`- Documents with missing/untitled titles: ${emptyTitles}`);
    console.log(`- Documents with missing URLs:             ${emptyUrls}`);
    console.log(`- Documents with empty content body:       ${emptyContent}\n`);

    // 4. Check for suspicious list/archive URLs in Silver
    console.log(
      "📂 4. Detecting Suspicious Archive / List Pages in Silver layer...",
    );
    const allSilverDocs = await sContents.find().toArray();
    const suspiciousDocs = allSilverDocs.filter((d) => {
      try {
        const urlStr = d.url;
        if (!urlStr) return false;
        const parsed = new URL(urlStr);
        const cleanPath = parsed.pathname.replace(/\/$/, "");

        // Count segments
        const segments = parsed.pathname.split("/").filter(Boolean);
        const isMultiSegment = segments.length > 1;

        const isKnownArchive = [
          "newsletter",
          "column-before",
          "economy-dictionary",
          "economy-news",
          "category",
        ].some((p) => cleanPath.includes(`/${p}`));

        return isMultiSegment || isKnownArchive;
      } catch {
        return false;
      }
    });

    if (suspiciousDocs.length === 0) {
      console.log(
        "✅ No suspicious list/archive pages detected in the Silver layer.\n",
      );
    } else {
      console.log(
        `⚠️ Found ${suspiciousDocs.length} suspicious list/archive pages:\n`,
      );
      for (const d of suspiciousDocs.slice(0, 10)) {
        console.log(`  * Title: "${d.title}"`);
        console.log(`    URL:   ${d.url}`);
        console.log(`    ID:    ${d.id}`);
        console.log("");
      }
      if (suspiciousDocs.length > 10) {
        console.log(`  ... and ${suspiciousDocs.length - 10} more.`);
      }
      console.log("");
    }

    // 5. Compare MongoDB with Meilisearch to find Orphaned items (causing Document Not Found)
    console.log(
      "👻 5. Detecting Orphaned Meilisearch Documents (Not in MongoDB)",
    );
    try {
      const indexName = getIndexName(siteKey);
      const meiliResults = await meili.search(indexName, "", { limit: 1000 });
      const meiliHits = meiliResults.hits;

      const orphaned = [];
      for (const hit of meiliHits) {
        const docId = (hit as any).docId; // This is the ID in MongoDB
        const mongoExists = await sContents.findOne({ id: docId });
        if (!mongoExists) {
          orphaned.push(hit);
        }
      }

      if (orphaned.length === 0) {
        console.log("✅ No orphaned Meilisearch documents detected.\n");
      } else {
        console.log(
          `⚠️ Found ${orphaned.length} orphaned Meilisearch documents (causes "Document not found" in viewer):\n`,
        );
        for (const hit of orphaned.slice(0, 10)) {
          console.log(`  * Title:  "${hit.title}"`);
          console.log(`    URL:    ${hit.url}`);
          console.log(
            `    docId:  ${hit.docId} (composite ID in Meili: ${hit.id})`,
          );
          console.log("");
        }
        if (orphaned.length > 10) {
          console.log(`  ... and ${orphaned.length - 10} more.`);
        }
        console.log("");
      }
    } catch (meiliErr: any) {
      console.warn(
        `⚠️ Could not query Meilisearch for orphans: ${meiliErr.message}\n`,
      );
    }

    console.log("🏁 Diagnostics complete!");
  } catch (error: any) {
    console.error("❌ Diagnostic run failed with error:", error.message);
  } finally {
    await mongo.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
