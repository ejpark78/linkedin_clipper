/**
 * @module parser
 * @description Core functionality or script runner for parser.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies None
 * @lastUpdated 2026-06-11
 */

import * as crypto from "crypto";

export class EmailParser {
  static cleanFilename(title: string | undefined): string {
    if (!title) return "Untitled_Mail";
    return title
      .replace(/[\\/*?:"<>|]/g, "")
      .trim()
      .replace(/\//g, "_")
      .substring(0, 100);
  }

  static convertToKstIso(dateObj: Date | undefined): [string, string, string] {
    if (!dateObj) return ["Unknown-Date", "Unknown-Date", "Unknown-Date"];
    try {
      const KST_OFFSET = 9 * 60 * 60 * 1000;
      const kstDate = new Date(dateObj.getTime() + KST_OFFSET);
      const isoStr = dateObj.toISOString().replace("Z", "+09:00");

      const pad = (n: number) => String(n).padStart(2, "0");
      const yearMonth = `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth() + 1)}`;
      const yearMonthTime = `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth() + 1)}-${pad(kstDate.getUTCDate())}_${pad(kstDate.getUTCHours())}-${pad(kstDate.getUTCMinutes())}-${pad(kstDate.getUTCSeconds())}`;

      return [isoStr, yearMonth, yearMonthTime];
    } catch {
      return ["Unknown-Date", "Unknown-Date", "Unknown-Date"];
    }
  }

  static extractDomainTag(sender: string | undefined): string {
    if (!sender) return "from/unknown";
    const match = sender.match(/@([\w.-]+)/);
    if (match) {
      const parts = match[1].split(".");
      return `from/${parts[parts.length - 2] || parts[0]}`;
    }
    return "from/unknown";
  }

  static getSenderEmail(envelope: any): string {
    if (!envelope) return "unknown";
    if (envelope.from && envelope.from.length > 0) {
      return envelope.from[0].address || envelope.from[0].name || "unknown";
    }
    if (typeof envelope === "string") {
      const match = envelope.match(/<([^>]+)>/);
      if (match) return match[1];
      return envelope;
    }
    return "unknown";
  }

  static generateUniqueId(
    dateObj: Date | undefined,
    senderEmail: string | undefined,
  ): string {
    const emailClean = (senderEmail || "unknown").toLowerCase().trim();
    const hash = crypto
      .createHash("md5")
      .update(emailClean)
      .digest("hex")
      .substring(0, 8);
    if (!dateObj) {
      return `unknown_${hash}`;
    }
    try {
      const KST_OFFSET = 9 * 60 * 60 * 1000;
      const kstDate = new Date(dateObj.getTime() + KST_OFFSET);
      const pad = (n: number) => String(n).padStart(2, "0");
      const datePart = `${kstDate.getUTCFullYear()}${pad(kstDate.getUTCMonth() + 1)}${pad(kstDate.getUTCDate())}_${pad(kstDate.getUTCHours())}${pad(kstDate.getUTCMinutes())}${pad(kstDate.getUTCSeconds())}`;
      return `${datePart}_${hash}`;
    } catch {
      return `error_${hash}`;
    }
  }
}
