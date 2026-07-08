/**
 * @module DateUtils
 * @description Core functionality or script runner for DateUtils.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies None
 * @lastUpdated 2026-06-11
 */

export class DateUtils {
  /**
   * 🕒 상대 시간을 날짜 포맷(YYYY-MM-DD)으로 변환하는 정밀 헬퍼
   */
  public static parseRelativeDate(
    relativeStr: string,
    timeStr: string,
    baseDateInput?: Date,
  ): string {
    let baseDate = baseDateInput ? new Date(baseDateInput) : new Date();
    if (isNaN(baseDate.getTime())) {
      baseDate = new Date();
    }

    let daysAgo = 0;
    let foundRelative = false;

    const matchRegex =
      /(\d+)\s*(day|week|month|year|hour|minute|second|일|주|달|개월|년|시간|분|초)s?\s*ago/i;
    const matchRegexKo = /(\d+)\s*(일|주|달|개월|년|시간|분|초)\s*전/i;
    const matchRegexRaw = /(\d+)\s*(day|week|month|year|hour|minute|second)s?/i;

    const match =
      (relativeStr || "").match(matchRegex) ||
      (relativeStr || "").match(matchRegexKo) ||
      (relativeStr || "").match(matchRegexRaw);
    if (match) {
      const val = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      if (unit.startsWith("day") || unit === "일") daysAgo = val;
      else if (unit.startsWith("week") || unit === "주") daysAgo = val * 7;
      else if (unit.startsWith("month") || unit === "달" || unit === "개월")
        daysAgo = val * 30;
      else if (unit.startsWith("year") || unit === "년") daysAgo = val * 365;
      foundRelative = true;
    }

    if (!foundRelative && timeStr) {
      const match =
        timeStr.match(matchRegex) ||
        timeStr.match(matchRegexKo) ||
        timeStr.match(matchRegexRaw);
      if (match) {
        const val = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        if (unit.startsWith("day") || unit === "일") daysAgo = val;
        else if (unit.startsWith("week") || unit === "주") daysAgo = val * 7;
        else if (unit.startsWith("month") || unit === "달" || unit === "개월")
          daysAgo = val * 30;
        else if (unit.startsWith("year") || unit === "년") daysAgo = val * 365;
      }
    }

    baseDate.setDate(baseDate.getDate() - daysAgo);
    const year = baseDate.getFullYear();
    const month = String(baseDate.getMonth() + 1).padStart(2, "0");
    const day = String(baseDate.getDate()).padStart(2, "0");
    const hour = String(baseDate.getHours()).padStart(2, "0");
    const minute = String(baseDate.getMinutes()).padStart(2, "0");
    const second = String(baseDate.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  /**
   * 🕒 초 단위를 시/분/초 문자열로 포맷팅
   */
  public static formatSeconds(totalSec: number): string {
    const H = Math.floor(totalSec / 3600);
    const M = Math.floor((totalSec % 3600) / 60);
    const S = totalSec % 60;
    if (H > 0) {
      return `${H}h ${M}m ${S}s`;
    } else if (M > 0) {
      return `${M}m ${S}s`;
    }
    return `${S}s`;
  }

  /**
   * 🕒 문자열 입력을 받아 안전하게 Date 객체 또는 null을 반환하는 유틸
   */
  public static parseSafeDate(
    dateInput: string | Date | null | undefined,
  ): Date | null {
    if (!dateInput) {
      return null;
    }
    if (dateInput instanceof Date) {
      return isNaN(dateInput.getTime()) ? null : dateInput;
    }

    // 문자열 정리 (예: '2026.06.20' -> '2026-06-20')
    let cleaned = dateInput.trim();
    if (cleaned.match(/^\d{4}\.\d{2}\.\d{2}$/)) {
      cleaned = cleaned.replace(/\./g, "-");
    }

    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
  }
}
