/**
 * @module SiteRegistry
 * @description Automatically discovers and registers site scraping and converting descriptors.
 * @constraints
 *   - Site configurations must define a unique key.
 *   - Automatically scans direct subdirectories of src/crawler/sites.
 * @dependencies Node fs/path, IConverter
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import type { IConverter, IFileSaver } from "./IConverter";

export interface IndexSpec {
  collection: `bronze/${string}` | `silver/${string}`;
  fields: Record<string, unknown>;
  options?: object;
}

export interface SiteDescriptor {
  key: string;
  name: string;
  domain?: string;
  seedUrls?: string[];
  favicon?: string;
  indexName?: string;

  indexes?: IndexSpec[];

  scraper?: {
    collectionName: `bronze/${string}`;
    targetCollection: string;
    updateFilterKey: string;
    defaultSlack: number;
    extractId: (url: string) => string;
    urlsCollectionName?: `bronze/${string}`;
    scrape: (url: string, tempPath: string) => Promise<void>;
    excludePatterns?: string[];
    urlFilter?: (url: string) => boolean;
    htmlSourcesToScan?: string[];
    generateUrls?: (
      config: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => string[];
  };

  converter?: {
    converter: IConverter<unknown> & Partial<IFileSaver>;
    targetCollection: string;
    filter: (id: string) => Record<string, unknown>;
    statusCollection?: string;
    statusFilterField?: string;
    completedSetKey: string;
  };

  targetLoader?: {
    collectionName: `silver/${string}`;
    filterField: string;
    buildDocument: (id: string, meta: unknown) => Record<string, unknown>;
  };

  listsCollectionName?: `bronze/${string}`;
  companyUrlsCollectionName?: `bronze/${string}`;

  refreshSilver?: {
    saveJson?: boolean;
    extractId?: (doc: Record<string, unknown>) => string;
    getSilverFields?: (meta: unknown) => Record<string, unknown>;
    imageDownload?: {
      enabled: boolean;
      htmlSource?: "rawContent" | "shortContent";
      removeFavicons?: boolean;
    };
  };
}

const registry = new Map<string, SiteDescriptor>();

function discoverSites(): void {
  const staticConfigPath = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "config",
    "sites.json",
  );
  const isViewer = process.env.IS_VIEWER === "true";

  if (isViewer && fs.existsSync(staticConfigPath)) {
    try {
      const raw = fs.readFileSync(staticConfigPath, "utf8");
      const staticConfigs = JSON.parse(raw);
      for (const s of staticConfigs) {
        registry.set(s.key, {
          key: s.key,
          name: s.name,
          favicon: s.favicon,
          indexName: s.indexName,
          targetLoader: {
            collectionName: s.collectionName,
            filterField: "id",
            buildDocument: () => ({}),
          },
          scraper: s.bronzeCollectionName
            ? {
                collectionName: s.bronzeCollectionName,
                updateFilterKey: s.updateFilterKey || "id",
              }
            : undefined,
        } as unknown as SiteDescriptor);
      }
      console.log(
        `✅ [SiteRegistry] Loaded ${staticConfigs.length} site descriptors statically from config/sites.json`,
      );
      return;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[SiteRegistry] Failed to load static config from ${staticConfigPath}: ${errorMsg}`,
      );
    }
  }

  const sitesDir = path.resolve(__dirname, "..", "sites");

  if (!fs.existsSync(sitesDir)) return;

  for (const dir of fs.readdirSync(sitesDir)) {
    const dirPath = path.join(sitesDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const configPath = path.join(dirPath, "site.config");
    if (
      fs.existsSync(configPath + ".ts") ||
      fs.existsSync(configPath + ".js")
    ) {
      try {
        const mod = require(configPath) as { descriptor: SiteDescriptor };
        if (mod.descriptor) {
          if (registry.has(mod.descriptor.key)) {
            throw new Error(
              `Duplicate site key collision detected: key '${mod.descriptor.key}' is already registered.`,
            );
          }
          registry.set(mod.descriptor.key, mod.descriptor);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[SiteRegistry] Failed to load config: ${configPath} - ${errorMsg}`,
        );
        throw err;
      }
    }

    for (const subDir of fs.readdirSync(dirPath)) {
      const subDirPath = path.join(dirPath, subDir);
      if (!fs.statSync(subDirPath).isDirectory()) continue;

      const subConfigPath = path.join(subDirPath, "site.config");
      if (
        fs.existsSync(subConfigPath + ".ts") ||
        fs.existsSync(subConfigPath + ".js")
      ) {
        try {
          const mod = require(subConfigPath) as { descriptor: SiteDescriptor };
          if (mod.descriptor) {
            if (registry.has(mod.descriptor.key)) {
              throw new Error(
                `Duplicate site key collision detected: key '${mod.descriptor.key}' is already registered.`,
              );
            }
            registry.set(mod.descriptor.key, mod.descriptor);
          }
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(
            `[SiteRegistry] Failed to load config: ${subConfigPath} - ${errorMsg}`,
          );
          throw err;
        }
      }
    }
  }
}

discoverSites();

export function getSite(key: string): SiteDescriptor | undefined {
  const normalizedKey = key === "dailydoseofds" ? "dailydose_ds" : key;
  return registry.get(normalizedKey);
}

export function getAllSites(): SiteDescriptor[] {
  return Array.from(registry.values());
}

export function getIndexName(siteKey: string): string {
  const desc = getSite(siteKey);
  return desc?.indexName || siteKey;
}

export function getSiteKeyFromCollection(collectionName: string): string {
  if (collectionName === "linkedin.jobs") {
    return "linkedin";
  } else if (collectionName === "silver/linkedin.companies") {
    return "linkedin_company";
  } else if (collectionName.startsWith("silver/")) {
    return collectionName.replace("silver/", "").split(".")[0];
  } else {
    return collectionName.split(".")[0];
  }
}
