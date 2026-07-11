/**
 * @file AppConfig.ts
 * @description Centralized configuration loader for the LinkedIn Clipper application.
 * Defines, validates, and defaults all required environment variables.
 *
 * Dependencies: dotenv
 */

import * as dotenv from "dotenv";
dotenv.config();

// Helper to check if a flag exists (including key=value format)
const hasCliFlag = (flag: string): boolean => {
  return process.argv.includes(flag) || process.argv.some(arg => arg.startsWith(flag + "="));
};

// Helper to parse CLI flags
const getCliArg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  const prefixArg = process.argv.find(arg => arg.startsWith(flag + "="));
  if (prefixArg) {
    return prefixArg.substring(flag.length + 1);
  }
  return undefined;
};

export class AppConfig {
  /**
   * MongoDB Connection URI
   */
  public static readonly MONGO_URL: string =
    process.env.MONGO_URL || "mongodb://127.0.0.1:27017";

  /**
   * Target MongoDB Initial Database Name
   */
  public static readonly MONGO_INITDB_DATABASE: string =
    process.env.MONGO_INITDB_DATABASE || "linkedin";

  /**
   * Redis Connection URI
   */
  public static readonly REDIS_URL: string =
    process.env.REDIS_URL || "redis://redis:6379";

  /**
   * Session Storage Directory Path
   */
  public static readonly SESSION_DIR: string =
    process.env.SESSION_DIR || "data/sessions";

  /**
   * Browser HTML Dump Directory Path
   */
  public static readonly BROWSER_HTML_DIR: string =
    process.env.BROWSER_HTML_DIR || "data/browser/html";

  /**
   * Browser JSON Dump Directory Path
   */
  public static readonly BROWSER_JSON_DIR: string =
    process.env.BROWSER_JSON_DIR || "data/browser/json";

  /**
   * Crawler/Scraper Slack Interval (in seconds)
   */
  public static readonly LIST_SLACK: number = parseInt(
    getCliArg("--list-slack") || "3",
    10,
  );

  /**
   * Scraper Worker Slack Interval (in seconds)
   */
  public static readonly SCRAPER_SLACK: number = parseInt(
    process.env.SCRAPER_SLACK || "0",
    10,
  );

  /**
   * Scrape Task Priority Level
   */
  public static readonly PRIORITY: string = (getCliArg("--priority") || "medium")
    .toLowerCase()
    .trim();

  /**
   * Port for the Viewer UI Server
   */
  public static readonly PORT: number = parseInt(
    process.env.PORT || "3000",
    10,
  );

  /**
   * Meilisearch Connection URL
   */
  public static readonly MEILI_URL: string =
    process.env.MEILI_URL || "http://meilisearch:7700";

  /**
   * Meilisearch Master Key
   */
  public static readonly MEILI_MASTER_KEY: string =
    process.env.MEILI_MASTER_KEY || "superMasterKeySecret123";

  /**
   * Whether to overwrite existing files/documents
   */
  public static readonly OVERWRITE: boolean = hasCliFlag("--overwrite");

  /**
   * Whether to reset the silver database during conversion
   */
  public static readonly RESET: boolean = hasCliFlag("--reset");

  /**
   * Whether to login (scraper settings)
   */
  public static readonly LOGIN: boolean = hasCliFlag("--login");

  /**
   * Whether to reset error status on items
   */
  public static readonly ERROR_RESET: boolean = hasCliFlag("--error-reset");

  /**
   * Combined login flag using LOGIN or AUTH CLI flags
   */
  public static readonly USE_LOGIN: boolean =
    hasCliFlag("--login") || hasCliFlag("--auth");

  /**
   * Target crawler site (defaults to linkedin)
   */
  public static readonly SITE: string = getCliArg("--site") || "linkedin";

  /**
   * Page range parameter (default: 1-5)
   */
  public static readonly PAGE: string = getCliArg("--page") || "1-5";

  /**
   * Day filter parameter (e.g. for geeknews)
   */
  public static readonly DAY: string = getCliArg("--day") || "";

  /**
   * Query limits (e.g. for gpters)
   */
  public static readonly LIMIT: number = parseInt(getCliArg("--limit") || "20", 10);

  /**
   * Headless browser execution option (default: true, overridden by --no-headless)
   */
  public static readonly HEADLESS: boolean = !hasCliFlag("--no-headless");

  /**
   * Category filter for Uppity news (CLI flag: --section)
   */
  public static readonly SECTION: string = getCliArg("--section") || "";
}
