/**
 * @module site.config
 * @description Core functionality or script runner for site.config.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies SiteRegistry, Converter, Crawler, utils
 * @lastUpdated 2026-06-11
 */

import { URLSearchParams } from "url";
import type { SiteDescriptor } from "../../../core/SiteRegistry";
import { LinkedInMarkdownConverter } from "./Converter";
import { LinkedInCrawler } from "../Crawler";
import { UrlUtils } from "../../../utils";
import { AppConfig } from "../../../config/AppConfig";
import { NamingUtils } from "../../../utils";

import * as fs from "fs";
import * as path from "path";

export interface GlobalSettings {
  max_page?: number;
  f_TPR?: string | string[];
  sortBy?: string | string[];
  distance?: string | number | (string | number)[];
  spellCorrectionEnabled?: boolean;
  start?: number;
  geo_enable?: boolean;
}

export interface SearchTarget {
  keywords?: string[];
  location?: string;
  geoId?: string;
  max_page?: number;
  start?: number;
  enabled?: boolean;
}

export interface Config {
  global_settings?: GlobalSettings;
  search_targets?: SearchTarget[];
  direct_urls?: string[];
  geo_registry?: Record<string, string | number>;
  parameter_registry?: Record<string, Record<string, string>>;
}

export interface GenerateUrlsOptions {
  skipDirectUrls?: boolean;
}

function loadDefaultRegistry(): {
  geo_registry: Record<string, string | number>;
  parameter_registry: Record<string, Record<string, string>>;
} {
  try {
    const configPath = path.join(
      __dirname,
      "../../../../..",
      "config",
      "config.json",
    );
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return {
        geo_registry: config.geo_registry || {},
        parameter_registry: config.parameter_registry || {},
      };
    }
  } catch (e) {
    console.error("Failed to load default registries from config.json:", e);
  }
  return { geo_registry: {}, parameter_registry: {} };
}

export function generateUrls(
  config: Config,
  options: GenerateUrlsOptions = {},
): string[] {
  const skipDirectUrls = !!options.skipDirectUrls;
  const urls: string[] = [];
  const { global_settings, search_targets, direct_urls } = config;
  const globalSettings = global_settings || {};

  const defaultRegistry = loadDefaultRegistry();

  const activeGeoRegistry =
    config.geo_registry && Object.keys(config.geo_registry).length > 0
      ? config.geo_registry
      : defaultRegistry.geo_registry;
  const activeParameterRegistry =
    config.parameter_registry &&
    Object.keys(config.parameter_registry).length > 0
      ? config.parameter_registry
      : defaultRegistry.parameter_registry;

  // f_TPR 값을 배열로 표준화 및 레디스트리 파라미터 변환
  const raw_f_TPRs = globalSettings.f_TPR
    ? Array.isArray(globalSettings.f_TPR)
      ? globalSettings.f_TPR
      : [globalSettings.f_TPR]
    : [undefined];

  const f_TPRs = raw_f_TPRs.map((val) => {
    if (
      val &&
      activeParameterRegistry.f_TPR &&
      activeParameterRegistry.f_TPR[val] !== undefined
    ) {
      return activeParameterRegistry.f_TPR[val];
    }
    return val;
  });

  // sortBy 값을 배열로 표준화 및 레디스트리 파라미터 변환
  const raw_sortBys = globalSettings.sortBy
    ? Array.isArray(globalSettings.sortBy)
      ? globalSettings.sortBy
      : [globalSettings.sortBy]
    : [undefined];

  const sortBys = raw_sortBys.map((val) => {
    if (
      val &&
      activeParameterRegistry.sortBy &&
      activeParameterRegistry.sortBy[val] !== undefined
    ) {
      return activeParameterRegistry.sortBy[val];
    }
    return val;
  });

  // distance 값을 배열로 표준화
  const distances = globalSettings.distance
    ? Array.isArray(globalSettings.distance)
      ? globalSettings.distance
      : [globalSettings.distance]
    : [undefined];

  // 1. Compile search targets
  if (search_targets && Array.isArray(search_targets)) {
    search_targets
      .filter((target) => target.enabled !== false)
      .forEach((target) => {
        if (!target.keywords || !Array.isArray(target.keywords)) return;

        target.keywords.forEach((keyword) => {
          const maxPage =
            target.max_page !== undefined
              ? target.max_page
              : globalSettings.max_page;
          const pageCount =
            maxPage && Number.isInteger(maxPage) && maxPage > 0 ? maxPage : 1;

          // f_TPR, sortBy, distance의 모든 데카르트 곱 조합 순회
          f_TPRs.forEach((resolved_f_TPR) => {
            sortBys.forEach((resolved_sortBy) => {
              distances.forEach((resolved_distance) => {
                for (let i = 0; i < pageCount; i++) {
                  const params = new URLSearchParams();
                  params.append("keywords", keyword);

                  const resolvedGeoId = target.location
                    ? activeGeoRegistry[target.location]
                    : null;

                  if (resolvedGeoId) {
                    params.append("geoId", String(resolvedGeoId));
                  } else if (target.geoId) {
                    params.append("geoId", target.geoId);
                  } else if (target.location) {
                    params.append("location", target.location);
                  }

                  if (
                    resolved_distance !== undefined &&
                    resolved_distance !== null
                  ) {
                    params.append("distance", String(resolved_distance));
                  }
                  if (
                    resolved_f_TPR &&
                    resolved_f_TPR !== "any time" &&
                    resolved_f_TPR !== ""
                  ) {
                    params.append("f_TPR", resolved_f_TPR);
                  }
                  if (resolved_sortBy) params.append("sortBy", resolved_sortBy);
                  if (globalSettings.spellCorrectionEnabled !== undefined) {
                    params.append(
                      "spellCorrectionEnabled",
                      String(globalSettings.spellCorrectionEnabled),
                    );
                  }

                  const startVal = i * 25;
                  if (startVal > 0) {
                    params.append("start", String(startVal));
                  } else {
                    const explicitStart =
                      target.start !== undefined
                        ? target.start
                        : globalSettings.start;
                    if (explicitStart !== undefined && explicitStart > 0) {
                      params.append("start", String(explicitStart));
                    }
                  }

                  urls.push(
                    `https://www.linkedin.com/jobs/search/?${params.toString()}`,
                  );
                }
              });
            });
          });
        });
      });
  }

  // 2. Direct URLs 컴파일
  if (!skipDirectUrls && direct_urls && Array.isArray(direct_urls)) {
    direct_urls.forEach((url) => {
      if (url && url.trim()) {
        urls.push(url.trim());
      }
    });
  }

  return urls;
}

async function scrapeLinkedinJob(url: string, tempPath: string): Promise<void> {
  const crawler = new LinkedInCrawler({
    login: AppConfig.USE_LOGIN,
  });
  await crawler.scrapeJob(url, tempPath);
}

export interface JobMeta {
  jobId: string;
  company: string;
  jobTitle: string;
  rawLocation: string;
  locationDirName: string;
  postedDate: string;
  rawContent: string;
}

export const descriptor: SiteDescriptor = {
  key: "linkedin",
  name: "LinkedIn Jobs",
  favicon: "https://www.linkedin.com/favicon.ico",
  indexName: "linkedin_jobs",
  domain: "www.linkedin.com",

  indexes: [
    {
      collection: "bronze/linkedin.jobs",
      fields: { jobId: 1 },
      options: { unique: true },
    },
    { collection: "bronze/linkedin.jobs", fields: { collectedAt: -1 } },
    { collection: "bronze/linkedin.lists", fields: { listId: 1 } },
    { collection: "bronze/linkedin.lists", fields: { collectedAt: 1 } },
    { collection: "bronze/linkedin.job_urls", fields: { jobId: 1 } },
    { collection: "bronze/linkedin.job_urls", fields: { status: 1, jobId: 1 } },
    {
      collection: "silver/linkedin.jobs",
      fields: { jobId: 1 },
      options: { unique: true },
    },
    { collection: "silver/linkedin.jobs", fields: { location: 1 } },
    {
      collection: "silver/linkedin.jobs",
      fields: {
        title: "text",
        companyName: "text",
        description: "text",
        markdown: "text",
      },
      options: {
        weights: { title: 10, companyName: 5, description: 3, markdown: 2 },
        name: "text_idx",
      },
    },
  ],

  listsCollectionName: "bronze/linkedin.lists",
  companyUrlsCollectionName: "bronze/linkedin.company_urls",

  scraper: {
    collectionName: "bronze/linkedin.jobs",
    targetCollection: "linkedin.jobs",
    updateFilterKey: "jobId",
    defaultSlack: 0,
    extractId: (url) => UrlUtils.extractJobId(url) || "",
    urlsCollectionName: "bronze/linkedin.job_urls",
    excludePatterns: ["favicon", "login", "logout", "signup"],
    scrape: scrapeLinkedinJob,
    htmlSourcesToScan: ["bronze/linkedin.lists", "bronze/linkedin.jobs"],
    generateUrls: (config: Config, options?: GenerateUrlsOptions) =>
      generateUrls(config, options),
  },

  converter: {
    converter: new LinkedInMarkdownConverter(),
    targetCollection: "linkedin.jobs",
    filter: (id) => ({ jobId: id }),
    statusCollection: "bronze/linkedin.job_urls",
    statusFilterField: "jobId",
    completedSetKey: "sites:linkedin_jobs:completed",
  },

  targetLoader: {
    collectionName: "silver/linkedin.jobs",
    filterField: "jobId",
    buildDocument: (id, meta: JobMeta) => {
      const stdLoc = UrlUtils.standardizeLocation(meta.rawLocation);
      const companyId = meta.company
        ? NamingUtils.generateSafeFileName(meta.company, "")
        : null;
      return {
        jobId: id,
        title: meta.jobTitle || "Untitled",
        companyName: meta.company || null,
        companyId,
        description: meta.rawContent || null,
        location: meta.rawLocation || null,
        geo: stdLoc || "Unknown",
        workStyle: "정보 없음",
        url: `https://www.linkedin.com/jobs/view/${id}`,
        publishedAt: meta.postedDate || null,
        updatedAt: new Date(),
      };
    },
  },
};
