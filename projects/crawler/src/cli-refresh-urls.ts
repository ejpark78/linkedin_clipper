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

const siteKeys = [
  "aicasebook",
  "dailydoseofds",
  "geeknews",
  "gpters",
  "gpters_newsletter",
  "linkedin",
  "maily_josh",
  "nvidia",
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
  } else if (arg.startsWith("--priority=")) {
    priority = arg.substring(11);
  } else if (arg === "--priority") {
    priority = process.argv[i + 1] || "";
    i++;
  } else if (arg === "--overwrite") {
    overwrite = true;
  } else if (arg === "--error-reset") {
    errorReset = true;
  }
}

if (!siteKey) {
  console.log("ℹ️ [cli-refresh-urls] No site specified. Defaulting to wildcard (*) to run all sites.");
  siteKey = "*";
}

const runRefresh = async (key: string): Promise<void> => {
  const desc = getSite(key);
  if (!desc) {
    console.error(`Unknown site key: ${key}`);
    return;
  }
  if (!desc.converter?.completedSetKey) {
    console.warn(`⚠️ [cli-refresh-urls] Site ${key} has no converter.completedSetKey. Skipping.`);
    return;
  }

  const refresh = new BaseRefreshUrls({
    site: desc.key,
    displayName: desc.name,
    cacheSetKey: desc.converter.completedSetKey,
    legacyQueue: key === "gpters",
    priority: priority || undefined,
    overwrite: overwrite || undefined,
    errorReset: errorReset || undefined,
  });

  console.log(`🔄 Running refresh-urls for ${key}...`);
  await refresh.run().catch(console.error);
};

(async () => {
  if (siteKey === "*") {
    console.log(`🚀 [cli-refresh-urls] Wildcard (*) specified. Refreshing all sites: ${siteKeys.join(", ")}`);
    for (const key of siteKeys) {
      await runRefresh(key);
    }
  } else {
    await runRefresh(siteKey);
  }
  process.exit(0);
})();
