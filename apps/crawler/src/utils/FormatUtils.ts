/**
 * @module FormatUtils
 * @description Core functionality or script runner for FormatUtils.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies None
 * @lastUpdated 2026-06-11
 */

export class FormatUtils {
  /**
   * 🔢 천단위 콤마 포맷터 (예: 3000 -> 3,000)
   */
  public static formatThousand(num: number): string {
    return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /**
   * 🔗 마크다운 링크 청소기
   * 1) javascript:; 링크 제거
   * 2) [ \n\n 제목 \n\n ](url) 형태의 불필요한 줄바꿈 제거하여 [제목](url)으로 통합
   */
  public static cleanMarkdownLinks(markdown: string): string {
    if (!markdown) return "";

    // 1. javascript: 로 시작하는 링크 패턴 전체 제거
    let cleaned = markdown.replace(
      /\[\s*[\s\S]*?\s*\]\(javascript\s*:\s*.*?\)/gi,
      "",
    );

    // 2. [![alt](img_url) \n\n ](link_url) 형태 보정 (이미지 링크 내 줄바꿈 제거)
    cleaned = cleaned.replace(
      /\[\s*(!\[[\s\S]*?\]\([^)]+\))\s*\]\(([^)]+)\)/g,
      (match, image, url) => {
        return `[${image.trim()}](${url.trim()})`;
      },
    );

    // 3. [ \n\n title \n\n ](url) 형태 보정
    cleaned = cleaned.replace(
      /\[\s*([\s\S]*?)\s*\]\(([^)]+)\)/g,
      (match, title, url) => {
        const cleanTitle = title.trim().replace(/\s*\n\s*/g, " ");
        return `[${cleanTitle}](${url.trim()})`;
      },
    );

    // 4. [title]( url ) 또는 ![alt]( src ) 형태 보정 (괄호 안의 공백/줄바꿈 제거)
    cleaned = cleaned.replace(/\]\(\s*([^)]*?)\s*\)/g, (match, url) => {
      return `](${url.replace(/\s+/g, "")})`;
    });

    // 5. \[ 또는 \] 또는 \* 또는 \_ 같은 백슬래시 이스케이프 해제
    cleaned = cleaned.replace(/\\([!\[\]*_])/g, "$1");

    return cleaned;
  }
}
