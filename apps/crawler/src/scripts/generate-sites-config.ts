/**
 * @file generate-sites-config.ts
 * @description Build-time utility that extracts site descriptors' metadata and writes them
 *              to a static JSON file (config/sites.json) for lightweight viewer usage.
 * @constraints
 *   - Runs during build time on the host or inside a container.
 *   - Strictly typed.
 * @dependencies SiteRegistry, fs, path
 */

import * as fs from "fs";
import * as path from "path";
import {
  getAllSites,
  getIndexName,
  SiteDescriptor,
} from "../core/SiteRegistry";

interface StaticSiteConfig {
  key: string;
  name: string;
  favicon: string;
  indexName: string;
  collectionName: string;
  bronzeCollectionName?: string;
  updateFilterKey?: string;
}

function main() {
  console.log("🚀 Extracting site configurations metadata...");

  const sites = getAllSites();
  const staticConfigs: StaticSiteConfig[] = sites.map((s: SiteDescriptor) => {
    return {
      key: s.key,
      name: s.name,
      favicon: s.favicon || "",
      indexName: getIndexName(s.key),
      collectionName:
        s.targetLoader?.collectionName || `silver/${s.key}.contents`,
      bronzeCollectionName: s.scraper?.collectionName,
      updateFilterKey: s.scraper?.updateFilterKey,
    };
  });

  const configDir = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "viewer",
    "config",
  );
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const outputPath = path.join(configDir, "sites.json");
  fs.writeFileSync(outputPath, JSON.stringify(staticConfigs, null, 2), "utf8");

  console.log(`✅ Static sites configuration written to: ${outputPath}`);
}

main();
