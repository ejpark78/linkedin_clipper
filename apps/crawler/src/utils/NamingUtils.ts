/**
 * @module NamingUtils
 * @description Core functionality or script runner for NamingUtils.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path
 * @lastUpdated 2026-06-11
 */

export class NamingUtils {
  /**
   * 🔤 HTML 특수문자 엔티티 원복 (&amp; -> & 등)
   */
  public static decodeHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  /**
   * 다국어용 안전한 파일명 생성
   */
  public static generateSafeFileName(
    jobTitle: string,
    company: string,
  ): string {
    let cleanTitle = (jobTitle || "정보 없음").trim();
    let cleanCompany = (company || "정보 없음").trim();
    cleanTitle = this.decodeHtmlEntities(cleanTitle);
    cleanCompany = this.decodeHtmlEntities(cleanCompany);

    let safeName = `${cleanCompany} - ${cleanTitle}`
      .replace(/[\/\\:\*\?"<>\|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!safeName || safeName === "-") safeName = "정보 없음 - 정보 없음";
    if (safeName.length > 80) safeName = safeName.substring(0, 80).trim();
    return safeName;
  }

  private static countryCodeMap: Record<string, string> | null = null;

  /**
   * ISO 국가코드(2자리)를 표준 영문 국가명으로 변환
   */
  public static convertCountryCodeToName(code: string): string {
    if (!code) return "Unknown";
    const cleanCode = code.trim().toUpperCase();

    if (!NamingUtils.countryCodeMap) {
      try {
        const fs = require("fs");
        const path = require("path");
        const configPath = path.join(
          __dirname,
          "..",
          "..",
          "config",
          "country_codes.json",
        );
        if (fs.existsSync(configPath)) {
          NamingUtils.countryCodeMap = JSON.parse(
            fs.readFileSync(configPath, "utf-8"),
          );
        }
      } catch (err) {
        console.warn(
          "⚠️ country_codes.json 로드 실패, Fallback 방식을 사용합니다.",
          err,
        );
      }
    }

    if (NamingUtils.countryCodeMap && NamingUtils.countryCodeMap[cleanCode]) {
      return NamingUtils.countryCodeMap[cleanCode];
    }

    // 최소한의 Fallback 맵
    const fallbackMap: Record<string, string> = {
      KR: "South Korea",
      US: "United States",
      GB: "United Kingdom",
      JP: "Japan",
      CN: "China",
      DE: "Germany",
    };

    return fallbackMap[cleanCode] || cleanCode;
  }
}
