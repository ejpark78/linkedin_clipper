/**
 * @file clean_legacy_noise_ids.ts
 * @description Scans MongoDB across all sites to remove malformed legacy IDs containing
 * trailing Korean grammatical noise (e.g. "%EB%A5%BC", "%EC%97%90", "를") and schedules them for clean re-crawling.
 *
 * Rules Complied:
 * - Centralized Config: Uses AppConfig.
 * - Robust Error Handling: Ensures MongoDB connection is closed in finally block.
 * - Strict Typing: Standard Typescript typing.
 */

import { MongoDatabase } from "../database/mongo";
import { getAllSites } from "../core/SiteRegistry";
import { UrlUtils } from "../utils/UrlUtils";

class LegacyNoiseIdCleaner {
  private mongo = MongoDatabase.getInstance();

  public async run(): Promise<void> {
    console.log("🔌 Connecting to MongoDB...");
    await this.mongo.connect();

    const sites = getAllSites();
    let totalDeleted = 0;
    let totalRecovered = 0;

    for (const site of sites) {
      const siteKey = site.key;
      const scraper = site.scraper;
      if (!scraper) continue;

      const urlsCollectionName =
        scraper.urlsCollectionName || `bronze/${siteKey}.urls`;
      console.log(`\n📦 Processing collection: ${urlsCollectionName} ...`);

      const collection = await this.mongo.getCollection(
        urlsCollectionName as any,
      );

      // Find malformed documents containing Korean letters or URL percent encodings in their IDs
      const noiseCursor = collection.find({
        id: { $regex: /.*[가-힣%].*/ },
      });

      const malformedDocs = await noiseCursor.toArray();
      if (malformedDocs.length === 0) {
        console.log(`   ✅ No noise documents found in ${urlsCollectionName}.`);
        continue;
      }

      console.log(
        `   🔍 Found ${malformedDocs.length} noise document(s) to clean.`,
      );

      for (const doc of malformedDocs) {
        const malformedId = doc.id;
        const url = doc.url;
        if (!url) continue;

        // Clean the URL using standard strip tracking/noise logic
        const cleanUrl = UrlUtils.stripTrackingParams(url);
        const cleanId = scraper.extractId ? scraper.extractId(cleanUrl) : null;
        if (!cleanId) continue;

        // Delete the malformed noise document
        await collection.deleteOne({ _id: doc._id });
        totalDeleted++;
        console.log(
          `   🗑️ Deleted malformed document: [ID: ${malformedId}] -> URL: ${url}`,
        );

        // Check if a document with the clean ID already exists
        const existingCleanDoc = await collection.findOne({ id: cleanId });
        if (!existingCleanDoc) {
          // Recover: Re-schedule the document with status 'new' and pushedToRedis false
          await collection.updateOne(
            { id: cleanId },
            {
              $set: {
                id: cleanId,
                url: cleanUrl,
                title: doc.title || "Recovered Clean Target",
                status: "new",
                pushedToRedis: false,
                updatedAt: new Date(),
              },
            },
            { upsert: true },
          );
          totalRecovered++;
          console.log(
            `   ➕ Recovered clean target document: [ID: ${cleanId}] -> URL: ${cleanUrl}`,
          );
        } else {
          console.log(
            `   ⏭️ Clean document already exists: [ID: ${cleanId}]. Skipping recovery.`,
          );
        }
      }
    }

    console.log(`\n🎉 Data cleansing complete!`);
    console.log(`   ├─ Total Malformed Deleted: ${totalDeleted}`);
    console.log(`   └─ Total Clean Recovered:   ${totalRecovered}`);
  }

  public async close(): Promise<void> {
    await this.mongo.close();
  }
}

if (require.main === module) {
  (async () => {
    const cleaner = new LegacyNoiseIdCleaner();
    try {
      await cleaner.run();
    } catch (e: any) {
      console.error(`❌ Data cleansing failed: ${e.message}`, e);
      process.exit(1);
    } finally {
      await cleaner.close();
    }
  })();
}
