/**
 * @module site.config
 * @description Core functionality or script runner for site.config.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies SiteRegistry, Converter
 * @lastUpdated 2026-06-11
 */

import type { SiteDescriptor } from "../../../core/SiteRegistry";
import { CompanyMarkdownConverter } from "./Converter";
import { LinkedInCrawler } from "../Crawler";
import { AppConfig } from "../../../config/AppConfig";

async function scrapeLinkedinCompany(
  url: string,
  tempPath: string,
): Promise<void> {
  const crawler = new LinkedInCrawler({
    login: AppConfig.USE_LOGIN,
  });
  await crawler.scrapeCompanyAbout(url, tempPath);
}

export interface CompanyMeta {
  companyId: string;
  companyName: string;
  tagline: string;
  website: string;
  industry: string;
  companySize: string;
  employeeCount: string;
  hqCountry: string;
  hqGeographicArea: string;
  hqCity: string;
  hqPostalCode: string;
  hqLine1: string;
  hqLine2: string;
  hqDescription: string;
  founded: string;
  specialties: string;
  linkedinUrl: string;
  phone: string;
  parentCompany: string;
  rawContent: string;
}

export const descriptor: SiteDescriptor = {
  key: "linkedin_company",
  name: "LinkedIn Company",
  favicon: "https://www.linkedin.com/favicon.ico",
  indexName: "linkedin_company",

  indexes: [
    {
      collection: "bronze/linkedin.companies",
      fields: { companyId: 1 },
      options: { unique: true },
    },
    { collection: "bronze/linkedin.companies", fields: { collectedAt: -1 } },
    { collection: "bronze/linkedin.company_urls", fields: { companyId: 1 } },
    {
      collection: "bronze/linkedin.company_urls",
      fields: { status: 1, companyId: 1 },
    },
    {
      collection: "silver/linkedin.companies",
      fields: { companyId: 1 },
      options: { unique: true },
    },
  ],

  scraper: {
    collectionName: "bronze/linkedin.companies",
    targetCollection: "linkedin.companies",
    updateFilterKey: "companyId",
    defaultSlack: 0,
    extractId: (url) => {
      const parts = url.replace(/\/$/, "").split("/");
      return parts[parts.length - 1] || "";
    },
    excludePatterns: ["favicon", "login", "logout", "signup"],
    scrape: scrapeLinkedinCompany,
  },

  converter: {
    converter: new CompanyMarkdownConverter(),
    targetCollection: "linkedin.companies",
    filter: (id) => ({ companyId: id }),
    completedSetKey: "sites:linkedin_company:completed",
  },

  targetLoader: {
    collectionName: "silver/linkedin.companies",
    filterField: "companyId",
    buildDocument: (id, meta: CompanyMeta) => ({
      companyId: id,
      companyName: meta.companyName || "Unknown Company",
      tagline: meta.tagline || null,
      website: meta.website || null,
      industry: meta.industry || null,
      companySize: meta.companySize || null,
      description: meta.hqDescription || null,
      updatedAt: new Date(),
    }),
  },
};
