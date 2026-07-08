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
  pytorch_kr: "src/sites/pytorch_kr/List.ts",
  uppity: "src/sites/uppity/List.ts",
  yozm: "src/sites/yozm/List.ts",
};

let siteKey = "";
let page = "";
let day = "";
let limit = "";
let listSlack = "";

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--site") {
    siteKey = process.argv[i + 1] || "";
    i++;
  } else if (process.argv[i] === "--page") {
    page = process.argv[i + 1] || "";
    i++;
  } else if (process.argv[i] === "--day") {
    day = process.argv[i + 1] || "";
    i++;
  } else if (process.argv[i] === "--limit") {
    limit = process.argv[i + 1] || "";
    i++;
  } else if (process.argv[i] === "--list-slack") {
    listSlack = process.argv[i + 1] || "";
    i++;
  }
}

if (!siteKey) {
  console.error(
    "Usage: npx ts-node src/crawler/cli-list.ts --site <siteKey> [--page <page>] [--day <day>] [--limit <limit>] [--list-slack <sec>]",
  );
  process.exit(1);
}

const targetPath = pathMap[siteKey];
if (!targetPath) {
  console.error(`Unknown site key: ${siteKey}`);
  process.exit(1);
}

// Determine the positional argument to pass to target List.ts
let arg = page || "1";
if (siteKey === "geeknews" && day && day.trim() !== "") {
  arg = day;
} else if ((siteKey === "gpters" || siteKey === "gpters_newsletter") && limit) {
  arg = limit;
}

console.log(
  `🚀 [cli-list] Running list scraper for ${siteKey} (${targetPath}) with argument: ${arg}`,
);

const childEnv: Record<string, string | undefined> = {
  ...process.env,
};
if (page) {
  childEnv.PAGE = page;
}
if (listSlack) {
  childEnv.LIST_SLACK = listSlack;
}
const child = spawn("npx", ["ts-node", targetPath, arg], {
  stdio: "inherit",
  env: childEnv,
});

child.on("close", (code) => {
  process.exit(code || 0);
});
