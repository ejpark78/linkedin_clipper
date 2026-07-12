/**
 * @module cli-list
 * @description Central wrapper script to parse CLI flags and run site-specific List.ts crawlers.
 * @constraints
 *   - Parses --site, --page, --day, and --limit arguments.
 *   - Spawns the target site List.ts using npx ts-node.
 * @dependencies child_process, path
 * @lastUpdated 2026-06-12
 */

import { spawn } from "child_process";
import * as path from "path";

const pathMap: Record<string, string> = {
  aicasebook: "src/sites/aicasebook/List.ts",
  dailydoseofds: "src/sites/dailydoseofds/List.ts",
  geeknews: "src/sites/geeknews/List.ts",
  gpters: "src/sites/gpters/news/List.ts",
  gpters_newsletter: "src/sites/gpters/newsletter/List.ts",
  linkedin: "src/sites/linkedin/jobs/List.ts",
  maily_josh: "src/sites/maily/josh/List.ts",
  nvidia: "src/sites/nvidia/List.ts",
  pytorch_kr: "src/sites/pytorch_kr/List.ts",
  uppity: "src/sites/uppity/List.ts",
  yozm: "src/sites/yozm/List.ts",
};

let siteKey = "";
let page = "1-5";
let day = "";
let limit = "";
let listSlack = "";

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith("--site=")) {
    siteKey = arg.substring(7);
  } else if (arg === "--site") {
    siteKey = process.argv[i + 1] || "";
    i++;
  } else if (arg.startsWith("--page=")) {
    page = arg.substring(7);
  } else if (arg === "--page") {
    page = process.argv[i + 1] || "";
    i++;
  } else if (arg.startsWith("--day=")) {
    day = arg.substring(6);
  } else if (arg === "--day") {
    day = process.argv[i + 1] || "";
    i++;
  } else if (arg.startsWith("--limit=")) {
    limit = arg.substring(8);
  } else if (arg === "--limit") {
    limit = process.argv[i + 1] || "";
    i++;
  } else if (arg.startsWith("--list-slack=")) {
    listSlack = arg.substring(13);
  } else if (arg === "--list-slack") {
    listSlack = process.argv[i + 1] || "";
    i++;
  }
}

if (!siteKey) {
  console.log("ℹ️ [cli-list] No site specified. Defaulting to wildcard (*) to run all sites.");
  siteKey = "*";
}

const runScraper = (key: string, path: string): Promise<number> => {
  return new Promise((resolve) => {
    const spawnArgs = ["ts-node", path];
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg.startsWith("--site")) {
        if (!arg.includes("=")) {
          i++;
        }
        continue;
      }
      if (arg === "--list") {
        continue;
      }
      spawnArgs.push(arg);
    }

    console.log(
      `🚀 [cli-list] Running list scraper for ${key} (${path}) with args: ${spawnArgs.slice(2).join(" ")}`,
    );

    const child = spawn("npx", spawnArgs, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("close", (code) => {
      resolve(code || 0);
    });
  });
};

(async () => {
  if (siteKey === "*") {
    const keys = Object.keys(pathMap);
    console.log(`🚀 [cli-list] Wildcard (*) specified. Running scrapers for all sites: ${keys.join(", ")}`);
    for (const key of keys) {
      const path = pathMap[key];
      const code = await runScraper(key, path);
      if (code !== 0) {
        console.warn(`⚠️ [cli-list] Scraper for ${key} finished with non-zero exit code: ${code}`);
      }
    }
    process.exit(0);
  } else {
    const path = pathMap[siteKey];
    if (!path) {
      console.error(`Unknown site key: ${siteKey}`);
      process.exit(1);
    }
    const code = await runScraper(siteKey, path);
    process.exit(code);
  }
})();
