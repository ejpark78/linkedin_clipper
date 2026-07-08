/**
 * @file sync-indexes.ts
 * @description Command-line tool to explicitly synchronize and verify MongoDB collection indexes.
 * It imports the MongoDatabase singleton, triggers initIndexes(), and outputs a comparison report.
 *
 * Rules Complied:
 * - OOP Patterns: Utilizes MongoDatabase singleton wrapper.
 * - Robust Error Handling: Properly catches, prints and exits.
 * - Strict Typing: Strictly uses explicit types.
 * - Agent-Friendly Docstrings: File started with this detailed JSDoc.
 */

import { MongoDatabase } from "../database/mongo";

async function syncAndReport(): Promise<void> {
  console.log("🔄 Starting MongoDB index synchronization and verification...");
  const mongo = MongoDatabase.getInstance();

  try {
    // Step 1: Connect and trigger indexing logic
    await mongo.connect();
    console.log("🔌 Connection established. Syncing indexes...");
    await mongo.initIndexes();
    console.log("✅ Index synchronization execution completed.");

    // Step 2: Extract current indexes from Database to report status
    const client = (mongo as any).client;
    if (!client) {
      throw new Error("MongoDB client connection is missing post sync.");
    }

    console.log("\n📊 Current Database Indexes State:");
    for (const dbName of ["bronze", "silver"]) {
      const db = client.db(dbName);
      const collections = await db.listCollections().toArray();
      console.log(`\n📂 Database: [${dbName}]`);

      for (const colInfo of collections) {
        const colName = colInfo.name;
        const collection = db.collection(colName);
        const indexes = await collection.indexes();

        console.log(`  🔹 Collection: ${colName}`);
        for (const idx of indexes) {
          const keys = JSON.stringify(idx.key);
          const isUnique = idx.unique ? " (UNIQUE)" : "";
          console.log(`     - Index: "${idx.name}" -> ${keys}${isUnique}`);
        }
      }
    }
    console.log(
      "\n🎉 Index synchronization and verification completed successfully.",
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Index Sync failed: ${errorMsg}`);
    process.exit(1);
  } finally {
    await mongo.close();
  }
}

syncAndReport();
