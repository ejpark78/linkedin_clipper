/**
 * @module cli-refresh-urls
 * @description Core functionality or script runner for cli-refresh-urls.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies BaseRefreshUrls, SiteRegistry
 * @lastUpdated 2026-06-15
 */

import { BaseRefreshUrls } from "./core/BaseRefreshUrls";
import { getSite } from "./core/SiteRegistry";

let siteKey = "";
let priority = "";
let overwrite = false;
let errorReset = false;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--site") {
    siteKey = process.argv[i + 1] || "";
    i++;
  } else if (process.argv[i] === "--priority") {
    priority = process.argv[i + 1] || "";
    i++;
  } else if (process.argv[i] === "--overwrite") {
    overwrite = true;
  } else if (process.argv[i] === "--error-reset") {
    errorReset = true;
  }
}
if (!siteKey) {
  siteKey = process.argv[2];
}

if (!siteKey) {
  console.error(
    "Usage: npx ts-node src/crawler/cli-refresh-urls.ts --site <siteKey> [--priority <p>] [--overwrite] [--error-reset]",
  );
  process.exit(1);
}

const desc = getSite(siteKey);
if (!desc) {
  console.error(`Unknown site key: ${siteKey}`);
  process.exit(1);
}
if (!desc.converter?.completedSetKey) {
  console.error(`Site ${siteKey} has no converter.completedSetKey`);
  process.exit(1);
}

const refresh = new BaseRefreshUrls({
  site: desc.key,
  displayName: desc.name,
  cacheSetKey: desc.converter.completedSetKey,
  legacyQueue: siteKey === "gpters",
  priority: priority || undefined,
  overwrite: overwrite || undefined,
  errorReset: errorReset || undefined,
});

refresh.run().catch(console.error);
