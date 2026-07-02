import { MongoDatabase } from "../database/mongo";
import Redis from "ioredis";
import { getAllSites } from "../core/SiteRegistry";
import { AppConfig } from "../config/AppConfig";

async function diagnose() {
  const sites = getAllSites();
  const mongo = MongoDatabase.getInstance();
  await mongo.connect();

  const redis = new Redis(AppConfig.REDIS_URL);

  try {
    console.log(`=== 🕵️‍♂️ [Diagnostic] Checking All Registered Sites ===\n`);

    for (const site of sites) {
      const siteKey = site.key;
      console.log(`--------------------------------------------------`);
      console.log(`📡 Site: [${site.name}] (Key: ${siteKey})`);

      // 1. Redis completed cache check
      const cacheSetKey =
        site.converter?.completedSetKey || `completed_${siteKey}`;
      const completedCount = await redis.scard(cacheSetKey);
      console.log(
        `   ├─ Redis Cache Key: "${cacheSetKey}" -> Size: ${completedCount}`,
      );

      // 2. MongoDB Html Collection Check
      const htmlCollName =
        site.scraper?.collectionName || `bronze/${siteKey}.html`;
      let totalHtml = 0;
      try {
        const htmlColl = await mongo.getCollection(htmlCollName as any);
        totalHtml = await htmlColl.countDocuments();
      } catch (e) {}
      console.log(
        `   ├─ MongoDB HTML ("${htmlCollName}") -> Count: ${totalHtml}`,
      );

      // 3. MongoDB Urls Collection Check
      const urlsCollName =
        site.scraper?.urlsCollectionName || `bronze/${siteKey}.urls`;
      let totalUrls = 0;
      let sampleDoc: any = null;
      try {
        const urlsColl = await mongo.getCollection(urlsCollName as any);
        totalUrls = await urlsColl.countDocuments();
        sampleDoc = await urlsColl.findOne({});
      } catch (e) {}
      console.log(
        `   └─ MongoDB URLs ("${urlsCollName}") -> Count: ${totalUrls}`,
      );

      if (sampleDoc) {
        const expectedId = site.scraper?.extractId
          ? site.scraper.extractId(sampleDoc.url)
          : null;
        const inCache = await redis.sismember(cacheSetKey, sampleDoc.id || "");
        console.log(
          `      └─ Sample Check -> Stored ID: ${sampleDoc.id} | Expected ID: ${expectedId} | Matches: ${sampleDoc.id === expectedId} | Status: ${sampleDoc.status} | pushedToRedis: ${sampleDoc.pushedToRedis} | In Redis Cache: ${!!inCache}`,
        );
      }
    }
  } catch (err: any) {
    console.error("❌ Error during diagnostics:", err);
  } finally {
    await redis.quit();
    await mongo.close();
  }
}

diagnose().then(() => console.log("\n👋 Diagnostics complete."));
