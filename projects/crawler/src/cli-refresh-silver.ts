/**
 * @module cli-refresh-silver
 * @description Core functionality or script runner for cli-refresh-silver.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies SiteRegistry, BaseRefreshConvert
 * @lastUpdated 2026-06-15
 */

import { getSite } from "./core/SiteRegistry";
import { BaseRefreshConvert } from "./core/BaseRefreshConvert";

let siteKey = "";
let overwrite = false;
let reset = false;

const siteKeys = [
  "aicasebook",
  "dailydoseofds",
  "geeknews",
  "gpters",
  "gpters_newsletter",
  "linkedin",
  "maily_josh",
  "pytorch_kr",
  "uppity",
  "yozm",
];

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith("--site=")) {
    siteKey = arg.substring(7);
  } else if (arg === "--site") {
    siteKey = process.argv[i + 1] || "";
    i++;
  } else if (arg === "--overwrite") {
    overwrite = true;
  } else if (arg === "--reset") {
    reset = true;
  }
}

if (!siteKey) {
  console.log("ℹ️ [cli-refresh-silver] No site specified. Defaulting to wildcard (*) to run all sites.");
  siteKey = "*";
}

const runRefreshConvert = async (key: string): Promise<void> => {
  const desc = getSite(key);
  if (!desc) {
    console.error(`Unknown site key: ${key}`);
    return;
  }
  if (!desc.scraper?.collectionName) {
    console.warn(`⚠️ [cli-refresh-silver] Site ${key} has no scraper.collectionName. Skipping.`);
    return;
  }

  console.log(`🔄 Running refresh-silver for ${key} (Queue-based)...`);
  const refreshConvert = new BaseRefreshConvert({
    site: desc.key,
    bronzeCollection: desc.scraper.collectionName,
    idExtract:
      key === "gpters" ? (doc: any) => doc.id || doc.postId : undefined,
    includeUrlInPayload: key === "gpters",
    overwrite,
    reset,
  });
  await refreshConvert.run().catch(console.error);
};

(async () => {
  if (siteKey === "*") {
    console.log(`🚀 [cli-refresh-silver] Wildcard (*) specified. Refreshing all sites: ${siteKeys.join(", ")}`);
    for (const key of siteKeys) {
      await runRefreshConvert(key);
    }
  } else {
    await runRefreshConvert(siteKey);
  }
  process.exit(0);
})();
