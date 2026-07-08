/**
 * @file show_collection_columns.ts
 * @description Script to connect to MongoDB, retrieve all collections under databases (bronze/silver),
 * query a sample document from each collection, extract field (column) names, and output a markdown table.
 */

import { MongoDatabase } from "../database/mongo";
import { MongoClient } from "mongodb";
import { AppConfig } from "../config/AppConfig";

async function main() {
  const mongoUrl = AppConfig.MONGO_URL;
  console.log(`🔌 Connecting to MongoDB at ${mongoUrl}...`);

  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();

    // Target databases
    const targetDbs = ["bronze", "silver"];

    for (const dbName of targetDbs) {
      const db = client.db(dbName);
      const collectionsInfo = await db.listCollections().toArray();
      const collectionNames = collectionsInfo.map((c) => c.name).sort();

      if (collectionNames.length === 0) {
        console.log(`\n# Database: ${dbName} (No collections found)\n`);
        continue;
      }

      console.log(`\n# Database: ${dbName}\n`);

      // Map to store collection name -> set of column/field keys
      const collectionColumnsMap: Record<string, string[]> = {};
      const allColumnsSet = new Set<string>();

      for (const colName of collectionNames) {
        const collection = db.collection(colName);
        // Get sample documents to discover columns
        const samples = await collection.find({}).limit(5).toArray();

        const colKeys = new Set<string>();
        for (const doc of samples) {
          Object.keys(doc).forEach((key) => {
            if (key !== "_id") {
              // Skip mongodb default _id for clean view unless needed
              colKeys.add(key);
            }
          });
        }
        const sortedKeys = Array.from(colKeys).sort();
        collectionColumnsMap[colName] = sortedKeys;
        sortedKeys.forEach((k) => allColumnsSet.add(k));
      }

      const allColumnsSorted = Array.from(allColumnsSet).sort();

      // Extract all unique collection suffixes/types (e.g., contents, urls, html, lists, companies, jobs, company_urls, job_urls)
      const collectionTypesSet = new Set<string>();
      for (const colName of collectionNames) {
        const parts = colName.split(".");
        if (parts.length > 1) {
          collectionTypesSet.add(parts.slice(1).join("."));
        } else {
          collectionTypesSet.add(colName);
        }
      }
      const collectionTypes = Array.from(collectionTypesSet).sort();

      for (const colType of collectionTypes) {
        // Find all collections matching this type (suffix)
        const matchedCols = collectionNames.filter((name) => {
          const parts = name.split(".");
          const suffix = parts.length > 1 ? parts.slice(1).join(".") : name;
          return suffix === colType;
        });

        if (matchedCols.length === 0) continue;

        // Site names (prefix of the collection) will be the table columns (가로)
        const siteNames = matchedCols.map((name) => name.split(".")[0]);

        // All unique fields/columns for this collection type across all matching sites
        const activeFieldsSet = new Set<string>();
        matchedCols.forEach((colName) => {
          collectionColumnsMap[colName].forEach((field) =>
            activeFieldsSet.add(field),
          );
        });
        const activeFields = Array.from(activeFieldsSet).sort();

        if (activeFields.length === 0) continue;

        console.log(`### 📍 TYPE: ${colType}\n`);

        // Align table for readability:
        // Column 1 is "Field (세로)"
        const firstColWidth = Math.max(
          "Field / Column".length,
          ...activeFields.map((f) => `**${f}**`.length),
        );

        // Other columns are site names
        const colWidths = siteNames.map((site) => Math.max(site.length, 3));

        const padRight = (str: string, width: number) => {
          return str + " ".repeat(Math.max(0, width - str.length));
        };

        const padCenter = (str: string, width: number) => {
          const totalPadding = Math.max(0, width - str.length);
          const leftPadding = Math.floor(totalPadding / 2);
          const rightPadding = totalPadding - leftPadding;
          return " ".repeat(leftPadding) + str + " ".repeat(rightPadding);
        };

        // Header rows
        const headerParts = [padRight("Field / Column", firstColWidth)];
        const sepParts = [padRight(":---", firstColWidth)];

        siteNames.forEach((site, idx) => {
          headerParts.push(padCenter(site, colWidths[idx]));
          sepParts.push(padCenter(":---:", colWidths[idx]));
        });

        console.log(`| ${headerParts.join(" | ")} |`);
        console.log(`| ${sepParts.join(" | ")} |`);

        // Rows are fields (세로)
        for (const field of activeFields) {
          const rowParts = [padRight(`**${field}**`, firstColWidth)];
          matchedCols.forEach((colName, idx) => {
            const hasField = collectionColumnsMap[colName].includes(field);
            rowParts.push(padCenter(hasField ? "✅" : " ", colWidths[idx]));
          });
          console.log(`| ${rowParts.join(" | ")} |`);
        }
        console.log("\n");
      }
      console.log("---");
    }
  } catch (error) {
    console.error("❌ Error executing script:", error);
  } finally {
    await client.close();
  }
}

main();
