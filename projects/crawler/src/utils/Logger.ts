/**
 * @module Logger
 * @description Core functionality or script runner for Logger.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies os
 * @lastUpdated 2026-06-11
 */

import * as os from "os";
import { AsyncLocalStorage } from "async_hooks";

export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

export class Logger {
  private static hostname = os.hostname();
  private static isJson = process.env.JSON_LOG === "true";
  public static contextStorage = new AsyncLocalStorage<{
    site?: string;
    url?: string;
  }>();

  public static info(message: string, meta?: Record<string, any>) {
    this.log(LogLevel.INFO, message, meta);
  }

  public static warn(message: string, meta?: Record<string, any>) {
    this.log(LogLevel.WARN, message, meta);
  }

  public static error(
    message: string,
    error?: Error | any,
    meta?: Record<string, any>,
  ) {
    const errorMeta = error
      ? {
          error_name: error.name || "Error",
          error_message: error.message || String(error),
          error_stack: error.stack,
        }
      : {};
    this.log(LogLevel.ERROR, message, { ...errorMeta, ...meta });
  }

  public static debug(message: string, meta?: Record<string, any>) {
    this.log(LogLevel.DEBUG, message, meta);
  }

  private static log(
    level: LogLevel,
    message: string,
    meta?: Record<string, any>,
  ) {
    const timestamp = new Date().toISOString();

    // Strip ANSI colors/escapes for clean log aggregation
    const cleanMessage = message.replace(
      /[\u001b\u009b][[()#;?]*(?:[a-zA-d]*(?:;[-a-zA-d]*)*)?/g,
      "",
    );

    // Extract site/url from AsyncLocalStorage context or meta or message brackets [site_name]
    const context = this.contextStorage.getStore();
    let site = meta?.site || context?.site || "";
    const url = meta?.url || context?.url || "";

    if (!site) {
      const match = message.match(/\[([a-zA-Z0-9_-]+)\]/);
      if (match) {
        const val = match[1];
        const exclude = [
          "scraper",
          "converter",
          "error",
          "warn",
          "info",
          "debug",
          "recursive",
        ];
        if (!exclude.includes(val.toLowerCase())) {
          site = val;
        }
      }
    }

    if (this.isJson) {
      const logPayload = {
        timestamp,
        level,
        hostname: this.hostname,
        site: site || undefined,
        url: url || undefined,
        message: cleanMessage,
        ...meta,
      };
      console.log(JSON.stringify(logPayload));
    } else {
      const siteStr = site ? ` [${site}]` : "";
      const metaString = meta ? ` | ${JSON.stringify(meta)}` : "";
      console.log(
        `[${timestamp}] [${level}]${siteStr} ${cleanMessage}${metaString}`,
      );
    }
  }
}
