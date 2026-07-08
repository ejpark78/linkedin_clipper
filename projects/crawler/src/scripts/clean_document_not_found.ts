/**
 * @file clean_document_not_found.ts
 * @description Script to connect to MongoDB, iterate through all .urls collections in the bronze database,
 * identify and delete any documents containing "document not found" (case-insensitive) in the error field.
 */

import { MongoClient } from "mongodb";
import { AppConfig } from "../config/AppConfig";

async function main() {
  const mongoUrl = AppConfig.MONGO_URL;
  console.log(`🔌 Connecting to MongoDB at ${mongoUrl}...`);
  const client = new MongoClient(mongoUrl);

  try {
    await client.connect();
    const db = client.db("bronze");
    const collectionsInfo = await db.listCollections().toArray();
    const collectionNames = collectionsInfo.map((c) => c.name).sort();

    console.log(
      `🔍 Scanning all collections in database "bronze" for "document not found" errors...`,
    );

    for (const colName of collectionNames) {
      if (colName.endsWith(".urls")) {
        const collection = db.collection(colName);

        // Match "document not found" case-insensitively
        const filter = { error: /document not found/i };
        const deleteResult = await collection.deleteMany(filter);

        if (deleteResult.deletedCount > 0) {
          console.log(
            `🧹 Cleaned ${deleteResult.deletedCount} error documents from collection: ${colName}`,
          );
        }
      }
    }

    console.log("🎉 Cleanup completed successfully!");
  } catch (err) {
    console.error("❌ Cleanup failed with error:", err);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}
