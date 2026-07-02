/**
 * @module UrlUtils
 * @description Core functionality or script runner for UrlUtils.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path
 * @lastUpdated 2026-06-11
 */

const TRACKING_PARAMS = new Set([
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
]);
const SHARE_PARAMS = ["url", "u"];
const BINARY_EXTENSIONS =
  /\.(zip|pdf|png|jpe?g|gif|svg|mp[34]|mov|avi|exe|dmg|gz|tar|7z|rar|docx?|xlsx?|pptx?|webp|ico|css|js\.map?)$/i;

export class UrlUtils {
  /**
   * 🔗 다양한 링크드인 공고 URL에서 호환성 100%로 순수 숫자 JOB_ID를 추출하는 정밀 파서
   */
  public static extractJobId(url: string): string {
    const cleanUrl = url.trim().split("?")[0].replace(/\/$/, "");
    const segment = cleanUrl.split("/").pop() || "";

    // 패턴 A: 다국어/SEO 주소 대응 (예: ...-at-company-4421619932)
    const dashMatch = segment.match(/-([0-9]+)$/);
    if (dashMatch) {
      return dashMatch[1];
    }

    // 패턴 B: 클래식 숫자 주소 대응 (예: .../view/123456789)
    if (/^[0-9]+$/.test(segment)) {
      return segment;
    }

    // 패턴 C: 최후의 보루 (문자열 내 7자리 이상 숫자 블록 검출)
    const numberMatch = segment.match(/[0-9]{7,}/);
    if (numberMatch) {
      return numberMatch[0];
    }

    // 패턴 D: 최종 예외 대비 (안전한 글자 수 제한)
    return segment.substring(0, 50);
  }

  // 💡 country.json 캐싱용 변수
  private static countryMapping: Record<string, string[]> | null = null;

  public static standardizeLocation(rawLocation: string): string {
    if (
      !rawLocation ||
      rawLocation === "정보 없음" ||
      rawLocation === "No info"
    ) {
      return "unknown-location";
    }
    const cleanLoc = rawLocation.trim();

    // 1. 동적으로 country.json 불러오기 및 캐싱
    if (!UrlUtils.countryMapping) {
      try {
        const fs = require("fs");
        const path = require("path");
        const configPath = path.join(
          __dirname,
          "..",
          "..",
          "config",
          "country.json",
        );
        if (fs.existsSync(configPath)) {
          UrlUtils.countryMapping = JSON.parse(
            fs.readFileSync(configPath, "utf-8"),
          );
        }
      } catch (err) {
        console.warn(
          "⚠️ country.json 설정 파일을 로드하지 못했습니다. 기본 한국어 검사 폴백을 진행합니다.",
          err,
        );
      }
    }

    // 2. 외부 설정 값이 있을 경우 매핑 매칭 수행
    if (UrlUtils.countryMapping) {
      // 별칭(alias) 매칭 우선 진행 (예: 'APAC' 등 전역 별칭이 한국어 포함 문구보다 먼저 매칭되도록)
      for (const [country, aliases] of Object.entries(
        UrlUtils.countryMapping,
      )) {
        const escapedAliases = aliases.map((alias) =>
          alias.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"),
        );
        if (escapedAliases.length > 0) {
          const pattern = new RegExp(escapedAliases.join("|"), "i");
          if (pattern.test(cleanLoc)) {
            return country;
          }
        }
      }
      // 별칭 매칭 실패 시 한글 캐릭터셋 포함 시 한국으로 매핑
      if (/[가-힣]/.test(cleanLoc)) {
        return "South Korea";
      }
    } else {
      // Fallback (최소한의 예외 처리)
      if (
        /[가-힣]/.test(cleanLoc) ||
        /Korea|Seoul|서울|대한민국/i.test(cleanLoc)
      ) {
        return "South Korea";
      }
    }

    return cleanLoc.replace(/[\/\\:\*\?"<>\|]/g, " ").trim();
  }

  /**
   * 🏢 회사 URL에서 고유 식별자인 companyId를 추출하는 정밀 헬퍼
   */
  public static stripTrackingParams(url: string): string {
    try {
      const parsed = new URL(url);
      const clean = new URL(parsed.origin + parsed.pathname);
      for (const [key, value] of parsed.searchParams.entries()) {
        if (!TRACKING_PARAMS.has(key)) {
          clean.searchParams.set(key, value);
        }
      }
      const result = clean.toString();
      const splitIdx = result.indexOf("$%");
      const trimmedResult =
        splitIdx !== -1 ? result.substring(0, splitIdx) : result;
      return trimmedResult.replace(/(?:%[0-9A-Fa-f]{2}|[가-힣]+)+$/, "");
    } catch {
      return url.replace(/(?:%[0-9A-Fa-f]{2}|[가-힣]+)+$/, "");
    }
  }

  public static isBinaryUrl(url: string): boolean {
    try {
      const pathname = new URL(url).pathname;
      return BINARY_EXTENSIONS.test(pathname);
    } catch {
      return false;
    }
  }

  public static isSameDomain(
    hostname: string,
    configuredDomain: string,
  ): boolean {
    if (hostname === configuredDomain) return true;
    if (hostname.endsWith(`.${configuredDomain}`)) return true;
    if (hostname.includes(".") && configuredDomain.endsWith(`.${hostname}`))
      return true;
    return false;
  }

  public static extractDomainUrl(href: string, domain: string): string | null {
    try {
      const parsed = new URL(href);
      for (const param of SHARE_PARAMS) {
        const val = parsed.searchParams.get(param);
        if (!val) continue;
        try {
          const target = new URL(val);
          if (UrlUtils.isSameDomain(target.hostname, domain)) {
            return val;
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  public static extractCompanyId(url: string): string {
    const cleanUrl = url.trim().replace(/\/$/, "").split("?")[0];
    const segments = cleanUrl.split("/");
    const compIndex = segments.findIndex(
      (s) => s === "company" || s === "compay",
    );
    let companyId = "";
    if (compIndex !== -1 && segments[compIndex + 1]) {
      companyId = segments[compIndex + 1];
    } else {
      companyId = segments.pop() || "";
    }
    try {
      return decodeURIComponent(companyId);
    } catch (e) {
      return companyId;
    }
  }
}
