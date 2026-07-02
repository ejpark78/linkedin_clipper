import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import Redis from "ioredis";
import { MongoDatabase } from "../database/mongo";
import { Logger } from "../utils";
import { getSite } from "../core/SiteRegistry";

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const INDEX_QUEUE = "index_queue";

async function main() {
  const projectRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const docsDir = path.join(projectRoot, "data", "ebook", "output");

  if (!fs.existsSync(docsDir)) {
    Logger.error(`Ebook output directory does not exist: ${docsDir}`);
    process.exit(1);
  }

  Logger.info(`Connecting to Redis at ${REDIS_URL}...`);
  const redis = new Redis(REDIS_URL);

  const mongo = MongoDatabase.getInstance();
  await mongo.connect();

  const desc = getSite("ebook");
  if (!desc?.targetLoader) {
    Logger.error(`Ebook site descriptor targetLoader configuration not found.`);
    process.exit(1);
  }

  const tl = desc.targetLoader;
  const collection = await mongo.getCollection(tl.collectionName);

  Logger.info(`Scanning directory: ${docsDir}`);
  const bookDirs = fs.readdirSync(docsDir).filter((name) => {
    return (
      fs.statSync(path.join(docsDir, name)).isDirectory() && name !== "images"
    );
  });

  for (const bookTitle of bookDirs) {
    const bookPath = path.join(docsDir, bookTitle);
    Logger.info(`Processing book: ${bookTitle}`);

    const files = fs.readdirSync(bookPath).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(bookPath, file);
      const content = fs.readFileSync(filePath, "utf-8");

      // Extract chapter number from filename (e.g., "Chapter 1. Introduction.md" -> 1)
      let chapterIndex = 0;
      const numMatch =
        file.match(/(?:Chapter|chapter)\s*(\d+)/i) || file.match(/^(\d+)/);
      if (numMatch) {
        chapterIndex = parseInt(numMatch[1], 10);
      }

      const title = file.replace(/\.md$/, ""); // File name as title

      // Generate standard MD5 hash for ID (Failure Isolation Rules compliance)
      const id = crypto
        .createHash("md5")
        .update(`${bookTitle}_${title}`)
        .digest("hex");

      const meta = {
        title,
        bookTitle,
        chapterIndex,
        content,
      };

      const doc = tl.buildDocument(id, meta);

      // Upsert into MongoDB Silver
      await collection.updateOne(
        { [tl.filterField]: id },
        { $set: doc },
        { upsert: true },
      );
      Logger.info(
        `[Sync] Upserted [ebook] "${bookTitle}" - ${title} (ID: ${id})`,
      );

      // Push to Redis Indexer queue
      const payload = JSON.stringify({ site: "ebook", id });
      await redis.rpush(INDEX_QUEUE, payload);
    }
  }

  Logger.info("🎉 Ebook synchronization finished successfully!");
  await redis.quit();
  await mongo.close();
}

main().catch((err) => {
  Logger.error("Fatal sync error:", err);
  process.exit(1);
});
