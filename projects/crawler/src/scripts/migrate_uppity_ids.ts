/**
 * @file migrate_uppity_ids.ts
 * @description General-purpose command-line migration script to align MongoDB document IDs
 * with the updated URL normalization rules in each site's configuration.
 * Supports running for a specific site using the --site [siteKey] argument.
 * @constraints
 *   - Follows strict OOP patterns and clean error/connection handling.
 * @dependencies MongoDatabase, SiteRegistry
 * @lastUpdated 2026-06-15
 */

import { MongoDatabase } from "../database/mongo";
import { getSite, getAllSites } from "../core/SiteRegistry";

class IdMigrationRunner {
  private mongo = MongoDatabase.getInstance();

  public async run(siteKey: string): Promise<void> {
    if (!siteKey) {
      console.error("❌ Error: Missing --site [siteKey] argument.");
      this.printHelp();
      process.exit(1);
    }

    const site = getSite(siteKey);
    if (!site) {
      console.error(
        `❌ Error: Site "${siteKey}" is not registered in the SiteRegistry.`,
      );
      console.log(
        "Available sites:",
        getAllSites()
          .map((s) => s.key)
          .join(", "),
      );
      process.exit(1);
    }

    console.log(
      `🔌 Connecting to MongoDB for migrating site: [${site.name}]...`,
    );
    await this.mongo.connect();

    const scraper = site.scraper;
    if (!scraper) {
      throw new Error(`Scraper configuration is missing for site: ${siteKey}`);
    }

    const urlsCollectionName =
      scraper.urlsCollectionName || `bronze/${siteKey}.urls`;
    const htmlCollectionName =
      scraper.collectionName || `bronze/${siteKey}.html`;
    const contentsCollectionName =
      site.targetLoader?.collectionName || `silver/${siteKey}.contents`;

    const collectionsToMigrate = [
      { name: urlsCollectionName, idField: "id" },
      { name: htmlCollectionName, idField: scraper.updateFilterKey || "id" },
      {
        name: contentsCollectionName,
        idField: site.targetLoader?.filterField || "id",
      },
    ];

    for (const colSpec of collectionsToMigrate) {
      await this.migrateCollection(
        colSpec.name,
        colSpec.idField,
        scraper.extractId,
      );
    }

    console.log(
      `\n🎉 Migration for site [${site.name}] completed successfully!`,
    );
  }

  private async migrateCollection(
    collectionName: string,
    idField: string,
    extractIdFn: (url: string) => string | null,
  ): Promise<void> {
    console.log(
      `\n📦 Processing collection: ${collectionName} (using ID field: '${idField}')...`,
    );
    const collection = await this.mongo.getCollection(collectionName as any);

    // Fetch documents having both the ID field and url
    const cursor = collection
      .find({ url: { $exists: true } })
      .project({ _id: 1, [idField]: 1, url: 1 });

    let processedCount = 0;
    let migratedCount = 0;
    let deletedDuplicates = 0;

    for await (const doc of cursor) {
      processedCount++;
      const currentId = doc[idField] || doc.id;
      const url = doc.url;

      if (!url || !currentId) continue;

      const expectedId = extractIdFn(url);
      if (!expectedId) {
        console.warn(
          `⚠️ Warning: extractId returned null/empty for URL: ${url}`,
        );
        continue;
      }

      if (currentId !== expectedId) {
        // Check if a document with the expected ID already exists to avoid unique key index collisions
        const duplicate = await collection.findOne({ [idField]: expectedId });

        if (duplicate) {
          // Remove the old document because the normalized URL already exists under the correct ID
          await collection.deleteOne({ _id: doc._id });
          deletedDuplicates++;
          console.log(
            `   🗑️ Deleted duplicate document for URL: ${url} (Old ID: ${currentId} -> New ID: ${expectedId})`,
          );
        } else {
          // Update the ID field to the correct normalized ID
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                [idField]: expectedId,
                id: expectedId,
                updatedAt: new Date(),
              },
            },
          );
          migratedCount++;
        }
      }
    }

    console.log(`   ✨ Collection: ${collectionName} Summary:`);
    console.log(`      ├─ Processed: ${processedCount}`);
    console.log(`      ├─ Migrated:  ${migratedCount}`);
    console.log(`      └─ Duplicates Deleted: ${deletedDuplicates}`);
  }

  private printHelp(): void {
    console.log("\nUsage:");
    console.log(
      "  npx ts-node src/scripts/migrate_uppity_ids.ts --site <siteKey>",
    );
    console.log("\nExample:");
    console.log(
      "  npx ts-node src/scripts/migrate_uppity_ids.ts --site uppity",
    );
  }

  public async close(): Promise<void> {
    await this.mongo.close();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const siteIdx = args.indexOf("--site");
  const siteKey = siteIdx !== -1 ? args[siteIdx + 1] : "";

  (async () => {
    const runner = new IdMigrationRunner();
    try {
      await runner.run(siteKey);
    } catch (e: any) {
      console.error(`❌ Migration failed: ${e.message}`, e);
      process.exit(1);
    } finally {
      await runner.close();
    }
  })();
}
