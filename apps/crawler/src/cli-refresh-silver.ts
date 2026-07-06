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

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--site") {
    siteKey = process.argv[i + 1] || "";
    i++;
  } else if (process.argv[i] === "--overwrite") {
    overwrite = true;
  } else if (process.argv[i] === "--reset") {
    reset = true;
  }
}
if (!siteKey) {
  siteKey = process.argv[2];
}

if (!siteKey) {
  console.error(
    "Usage: npx ts-node src/crawler/cli-refresh-silver.ts --site <siteKey> [--overwrite] [--reset]",
  );
  process.exit(1);
}

const desc = getSite(siteKey);
if (!desc) {
  console.error(`Unknown site key: ${siteKey}`);
  process.exit(1);
}

console.log(`🔄 Running refresh for ${siteKey} (Queue-based)...`);
if (!desc.scraper?.collectionName) {
  console.error(`Site ${siteKey} has no scraper.collectionName`);
  process.exit(1);
}

const refreshConvert = new BaseRefreshConvert({
  site: desc.key,
  bronzeCollection: desc.scraper.collectionName,
  idExtract:
    siteKey === "gpters" ? (doc: any) => doc.id || doc.postId : undefined,
  includeUrlInPayload: siteKey === "gpters",
  overwrite,
  reset,
});
refreshConvert
  .run()
  .catch(console.error)
  .then(() => process.exit(0));
