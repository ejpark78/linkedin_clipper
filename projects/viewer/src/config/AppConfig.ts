/**
 * @file AppConfig.ts
 * @description Centralized configuration loader for the LinkedIn Clipper application.
 * Defines, validates, and defaults all required environment variables.
 * 
 * Dependencies: dotenv
 */

import * as dotenv from 'dotenv';
dotenv.config();

export class AppConfig {
    /**
     * MongoDB Connection URI
     */
    public static readonly MONGO_URL: string = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';

    /**
     * Target MongoDB Initial Database Name
     */
    public static readonly MONGO_INITDB_DATABASE: string = process.env.MONGO_INITDB_DATABASE || 'linkedin';

    /**
     * Redis Connection URI
     */
    public static readonly REDIS_URL: string = process.env.REDIS_URL || 'redis://redis:6379';

    /**
     * Session Storage Directory Path
     */
    public static readonly SESSION_DIR: string = process.env.SESSION_DIR || 'data/sessions';

    /**
     * Browser HTML Dump Directory Path
     */
    public static readonly BROWSER_HTML_DIR: string = process.env.BROWSER_HTML_DIR || 'data/browser/html';

    /**
     * Browser JSON Dump Directory Path
     */
    public static readonly BROWSER_JSON_DIR: string = process.env.BROWSER_JSON_DIR || 'data/browser/json';

    /**
     * Crawler/Scraper Slack Interval (in seconds)
     */
    public static readonly LIST_SLACK: number = parseInt(process.env.LIST_SLACK || '3', 10);

    /**
     * Scraper Worker Slack Interval (in seconds)
     */
    public static readonly SCRAPER_SLACK: number = parseInt(process.env.SCRAPER_SLACK || '0', 10);

    /**
     * Scrape Task Priority Level
     */
    public static readonly PRIORITY: string = (process.env.PRIORITY || 'medium').toLowerCase().trim();

    /**
     * Port for the Viewer UI Server
     */
    public static readonly PORT: number = parseInt(process.env.PORT || '3000', 10);

    /**
     * Meilisearch Connection URL
     */
    public static readonly MEILI_URL: string = process.env.MEILI_URL || 'http://meilisearch:7700';

    /**
     * Meilisearch Master Key
     */
    public static readonly MEILI_MASTER_KEY: string = process.env.MEILI_MASTER_KEY || 'superMasterKeySecret123';

    /**
     * Whether to overwrite existing files/documents
     */
    public static readonly OVERWRITE: boolean = process.env.OVERWRITE === 'true';

    /**
     * Whether to reset the silver database during conversion
     */
    public static readonly RESET: boolean = process.env.RESET === 'true';

    /**
     * Whether to login (scraper settings)
     */
    public static readonly LOGIN: boolean = process.env.LOGIN === 'true';

    /**
     * Whether to reset error status on items
     */
    public static readonly ERROR_RESET: boolean = process.env.ERROR_RESET === 'true';

    /**
     * Combined login flag using LOGIN or AUTH env variables
     */
    public static readonly USE_LOGIN: boolean = process.env.LOGIN === 'true' || process.env.AUTH === 'true';

    /**
     * Target crawler site (defaults to linkedin)
     */
    public static readonly SITE: string = process.env.SITE || 'linkedin';

    /**
     * Joplin API Web Clipper Connection URL
     */
    public static readonly JOPLIN_API_URL: string = process.env.JOPLIN_API_URL || 'http://host.docker.internal:41184';
}
