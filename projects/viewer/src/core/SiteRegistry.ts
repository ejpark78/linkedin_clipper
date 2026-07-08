/**
 * @module SiteRegistry
 * @description Automatically discovers and registers site scraping and converting descriptors.
 * @constraints
 *   - Site configurations must define a unique key.
 *   - Automatically scans direct subdirectories of src/crawler/sites.
 * @dependencies Node fs/path, IConverter
 * @lastUpdated 2026-06-11
 */

import * as fs from 'fs';
import * as path from 'path';

export interface IndexSpec {
  collection: `bronze/${string}` | `silver/${string}`;
  fields: Record<string, any>;
  options?: any;
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
    generateUrls?: (config: any, options?: any) => string[];
  };

  converter?: {
    converter: any;
    targetCollection: string;
    filter: (id: string) => Record<string, any>;
    statusCollection?: string;
    statusFilterField?: string;
    completedSetKey: string;
  };

  targetLoader?: {
    collectionName: `silver/${string}`;
    filterField: string;
    buildDocument: (id: string, meta: any) => Record<string, any>;
  };

  listsCollectionName?: `bronze/${string}`;
  companyUrlsCollectionName?: `bronze/${string}`;

  refreshSilver?: {
    saveJson?: boolean;
    extractId?: (doc: any) => string;
    getSilverFields?: (meta: any) => Record<string, any>;
    imageDownload?: {
      enabled: boolean;
      htmlSource?: 'rawContent' | 'shortContent';
      removeFavicons?: boolean;
    };
  };
}

const registry = new Map<string, SiteDescriptor>();

function discoverSites(): void {
  // 뷰어 환경이므로, 항상 루트/config/sites.json 정적 파일을 가져와 사이트 정보를 채웁니다.
  const staticConfigPath = path.resolve(__dirname, '..', '..', 'config', 'sites.json');

  if (fs.existsSync(staticConfigPath)) {
    try {
      const raw = fs.readFileSync(staticConfigPath, 'utf8');
      const staticConfigs = JSON.parse(raw);
      for (const s of staticConfigs) {
        registry.set(s.key, {
          key: s.key,
          name: s.name,
          favicon: s.favicon,
          indexName: s.indexName,
          targetLoader: {
            collectionName: s.collectionName,
            filterField: 'id',
            buildDocument: () => ({})
          },
          scraper: s.bronzeCollectionName ? {
            collectionName: s.bronzeCollectionName,
            updateFilterKey: s.updateFilterKey || 'id',
          } : undefined
        } as any);
      }
      console.log(`✅ [SiteRegistry] Loaded ${staticConfigs.length} site descriptors statically from config/sites.json`);
      return;
    } catch (err: any) {
      console.error(`[SiteRegistry] Failed to load static config from ${staticConfigPath}: ${err.message}`);
    }
  }
}

discoverSites();

export function getSite(key: string): SiteDescriptor | undefined {
  return registry.get(key);
}

export function getAllSites(): SiteDescriptor[] {
  return Array.from(registry.values());
}

export function getIndexName(siteKey: string): string {
  const desc = getSite(siteKey);
  return desc?.indexName || siteKey;
}

export function getSiteKeyFromCollection(collectionName: string): string {
  if (collectionName === 'linkedin.jobs') {
    return 'linkedin';
  } else if (collectionName === 'silver/linkedin.companies') {
    return 'linkedin_company';
  } else if (collectionName.startsWith('silver/')) {
    return collectionName.replace('silver/', '').split('.')[0];
  } else {
    return collectionName.split('.')[0];
  }
}
