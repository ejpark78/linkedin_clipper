/**
 * @module Crawler
 * @description Core functionality or script runner for Crawler.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies playwright, fs, path, utils
 * @lastUpdated 2026-06-11
 */

import { chromium, Browser, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { HtmlMinifier } from "../../utils";
import { AppConfig } from "../../config/AppConfig";

// ⚙️ LinkedIn Playwright 스크래퍼 및 인증 통합 OOP 엔진 (TypeScript)

export interface ICrawler {
  login(): Promise<void>;
  scrapeJob(url: string, outputPath: string): Promise<void>;
  scrapeCompanyAbout(url: string, outputPath: string): Promise<void>;
}

export class LinkedInCrawler implements ICrawler {
  private readonly sessionPath: string = path.join(
    AppConfig.SESSION_DIR,
    `${AppConfig.SITE}.json`,
  );
  private readonly useLogin: boolean;

  constructor(options: { login?: boolean } = {}) {
    this.useLogin =
      options.login !== undefined ? options.login : AppConfig.USE_LOGIN;
  }

  /**
   * 지능형 스크롤 함수: 레이아웃 변화에 상관없이 채용 공고 카드가 다 나타나도록 스크롤다운 유도
   */
  private async autoScroll(page: Page): Promise<void> {
    console.log(
      "🖱️  [목록 스크롤] 카드 로딩을 위해 채용 공고 패널을 스크롤하고 있습니다...",
    );
    await page.evaluate(async () => {
      const selectors = [
        ".jobs-search-results-list",
        ".scaffold-layout__list",
        "div[data-job-id]",
        "main section",
      ];

      let container: any = null;
      for (const sel of selectors) {
        const el = (document as any).querySelector(sel);
        if (el) {
          container = (el.closest('[class*="scroll"]') ||
            el.closest('[class*="list"]') ||
            el) as any;
          break;
        }
      }

      const scrollTarget = container || (window as any);

      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 120;
        const timer = setInterval(() => {
          const scrollHeight =
            scrollTarget === (window as any)
              ? (document as any).body.scrollHeight
              : scrollTarget.scrollHeight;

          if (scrollTarget === (window as any)) {
            (window as any).scrollBy(0, distance);
          } else {
            scrollTarget.scrollBy(0, distance);
          }
          totalHeight += distance;

          if (totalHeight >= scrollHeight || totalHeight > 10000) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  /**
   * 1회성 로그인 인증 세션 획득 로직
   */
  public async login(): Promise<void> {
    console.log("🌐 1회성 로그인 인증 브라우저를 구동합니다...");
    const configDir = path.dirname(this.sessionPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const browser: Browser = await chromium.launch({
      headless: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });

    // 🛡️ Google OAuth 로그인 시 "This browser or app may not be secure" 에러 방지를 위한 webdriver 감지 우회
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    const page: Page = await context.newPage();

    console.log(
      "📡 LinkedIn 로그인 페이지로 이동합니다. 인증을 완료해 주세요...",
    );
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
    });

    try {
      await page.waitForURL("**/feed/**", { timeout: 300000 });
      console.log("✅ 로그인이 성공적으로 감지되었습니다!");

      await context.storageState({ path: this.sessionPath });
      console.log(`💾 인증 토큰 세션 정보 저장 완료 ➡️ ${this.sessionPath}`);
    } catch (err: any) {
      console.error(
        `⚠️ 로그인 상태 수집 시간 초과 혹은 오류 발생: ${err.message}`,
      );
    } finally {
      await browser.close();
    }
  }

  /**
   * 단일 공고 내용 크롤러 (더보기 버튼 클릭 지원)
   */
  public async scrapeJob(url: string, outputPath: string): Promise<void> {
    const isLoggedIn = this.useLogin && fs.existsSync(this.sessionPath);
    const isHeadless = process.env.HEADLESS !== "false";
    const browser: Browser = await chromium.launch({
      headless: isHeadless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    try {
      const contextOptions: any = {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
      };
      if (isLoggedIn) {
        contextOptions.storageState = this.sessionPath;
      }

      const context = await browser.newContext(contextOptions);
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });
      const page: Page = await context.newPage();

      console.log("🌐 [1/4] 브라우저 기동 및 페이지 이동 중...");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const title = await page.title();
      if (title.includes("Sign In") || title.includes("로그인")) {
        throw new Error("⚠️ 세션 만료 또는 로그인 요청 화면 감지됨");
      }

      console.log(`🔗 [2/4] 페이지 로딩 완료: ${decodeURIComponent(url)}`);

      const showMoreSelector =
        'button.show-more-less-html__button--more, button[aria-label*="show more" i], button.jobs-description__footer-button';
      const button = await page.$(showMoreSelector);
      if (button) {
        console.log("🖱️ [3/4] 버튼 발견, 클릭하여 본문 확장 중...");
        try {
          // 🛡️ Playwright의 물리적 마우스 가로채기(Overlay interception) 타임아웃 오류를 완벽히 차단하기 위해 DOM 자바스크립트 직접 클릭 발송
          await page.evaluate((selector) => {
            const el = (document as any).querySelector(selector);
            if (el) el.click();
          }, showMoreSelector);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (clickErr: any) {
          console.warn(
            `⚠️ 본문 확장 클릭 도중 예외 발생 (스킵하지 않고 로드된 HTML은 그대로 보존 수집함): ${clickErr.message}`,
          );
        }
      } else {
        console.log("💡 [3/4] 추가로 확장할 더 보기 버튼이 없습니다.");
      }

      console.log("💾 [4/4] 렌더링 완료! 파일 저장 중...");
      const htmlContent = await page.content();
      const minifiedHtml = await HtmlMinifier.minify(htmlContent);

      const parentDir = path.dirname(outputPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(outputPath, minifiedHtml, "utf-8");
      console.log(
        `✨ 백업 성공 (압축 및 포맷팅 완료: ${(minifiedHtml.length / 1024).toFixed(1)} KB) -> ${outputPath}`,
      );

      // 🔑 로그인 성공/세션 유효 시 세션 만료 시간 연장을 위해 최신 쿠키를 파일에 도로 저장
      if (isLoggedIn) {
        await context.storageState({ path: this.sessionPath });
        console.log(`💾 [세션 자동 연장] 최신 로그인 세션 정보 업데이트 완료.`);
      }
    } finally {
      await browser.close();
    }
  }

  /**
   * 회사 정보 (/about/ 페이지) 크롤러
   */
  public async scrapeCompanyAbout(
    url: string,
    outputPath: string,
  ): Promise<void> {
    const isLoggedIn = this.useLogin && fs.existsSync(this.sessionPath);
    if (!isLoggedIn) {
      console.warn(
        "⚠️ [경고] 로그인 세션 파일(linkedin.json)이 없거나 login 옵션이 활성화되지 않아 비로그인으로 동작합니다. 회사 정보 스크래핑은 실패할 확률이 매우 높습니다.",
      );
    }

    // URL 정규화: 끝에 /about/ 이 없으면 자동으로 추가
    let targetUrl = url.trim();
    if (!targetUrl.replace(/\/$/, "").endsWith("/about")) {
      targetUrl = targetUrl.replace(/\/$/, "") + "/about/";
    }

    const isHeadless = process.env.HEADLESS !== "false";
    const browser: Browser = await chromium.launch({
      headless: isHeadless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    try {
      const contextOptions: any = {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
      };
      if (isLoggedIn) {
        contextOptions.storageState = this.sessionPath;
      }

      const context = await browser.newContext(contextOptions);
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });
      const page: Page = await context.newPage();

      console.log(
        `🌐 [1/4] 브라우저 기동 및 회사 정보 페이지 이동 중... (${decodeURIComponent(targetUrl)})`,
      );
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 페이지 타이틀 체크
      const title = await page.title();
      if (
        title.includes("Sign In") ||
        title.includes("로그인") ||
        title.includes("Sign Up") ||
        page.url().includes("authwall")
      ) {
        throw new Error("⚠️ 세션 만료 또는 로그인 요청 화면(Auth Wall) 감지됨");
      }

      console.log(`🔗 [2/4] 페이지 로딩 완료 (타이틀: ${title})`);

      // 비동기 하이드레이션 완료를 위한 핵심 셀렉터 대기
      console.log("⏳ [3/4] 회사 정보 카드 렌더링 대기 중...");
      try {
        await page.waitForSelector(
          ".org-page-details-module__card-spacing, dl",
          { timeout: 10000 },
        );
      } catch (selErr) {
        console.warn(
          "⚠️ 회사 세부 정보 카드가 10초 이내에 나타나지 않았습니다. 계속해서 덤프를 진행합니다.",
        );
      }

      console.log("💾 [4/4] 렌더링 완료! 파일 저장 중...");
      const htmlContent = await page.content();
      const minifiedHtml = await HtmlMinifier.minify(htmlContent);

      const parentDir = path.dirname(outputPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(outputPath, minifiedHtml, "utf-8");
      console.log(
        `✨ 회사 정보 백업 성공 (압축 및 포맷팅 완료: ${(minifiedHtml.length / 1024).toFixed(1)} KB) -> ${outputPath}`,
      );

      // 🔑 로그인 성공/세션 유효 시 세션 만료 시간 연장을 위해 최신 쿠키를 파일에 도로 저장
      if (isLoggedIn) {
        await context.storageState({ path: this.sessionPath });
        console.log(`💾 [세션 자동 연장] 최신 로그인 세션 정보 업데이트 완료.`);
      }
    } finally {
      await browser.close();
    }
  }

  /**
   * 🚀 직접 실행 컨트롤러 엔트리 메서드
   */
  public async run(): Promise<void> {
    const command = process.argv[2];

    try {
      if (command === "login") {
        await this.login();
        process.exit(0);
      } else if (command === "job") {
        const url = process.argv[3];
        const outputPath = process.argv[4];
        if (!url || !outputPath) {
          console.error(
            "❌ 사용법: npx ts-node crawler.ts job <공고_URL> <저장_HTML_경로>",
          );
          process.exit(1);
        }
        await this.scrapeJob(url, outputPath);
        process.exit(0);
      } else if (command === "company") {
        const url = process.argv[3];
        const outputPath = process.argv[4];
        if (!url || !outputPath) {
          console.error(
            "❌ 사용법: npx ts-node crawler.ts company <회사_URL> <저장_HTML_경로>",
          );
          process.exit(1);
        }
        await this.scrapeCompanyAbout(url, outputPath);
        process.exit(0);
      } else {
        console.error(
          "❌ 알 수 없는 명령어입니다. 사용 가능한 명령: login, job, company",
        );
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`\n❌ 크롤러 구동 에러: ${err.message}`);
      process.exit(1);
    }
  }
}

// 🏭 크롤러를 동적으로 생성하는 팩토리 클래스 (Factory Method Pattern 적용)
export class CrawlerFactory {
  public static createCrawler(platform: string): ICrawler {
    const lowerPlatform = platform.toLowerCase().trim();
    if (lowerPlatform === "linkedin") {
      return new LinkedInCrawler();
    }

    // 💡 Wanted 등 향후 새로운 타겟 플랫폼 확장 시 이곳에 분기만 간단히 추가하면 됨.
    // else if (lowerPlatform === 'wanted') {
    //     return new WantedCrawler();
    // }

    throw new Error(
      `[CrawlerFactory] 지원하지 않는 수집 플랫폼입니다: ${platform}`,
    );
  }
}

if (require.main === module) {
  const lastArg = process.argv[process.argv.length - 1];
  const platform =
    lastArg && ["linkedin"].includes(lastArg.toLowerCase())
      ? lastArg
      : "linkedin";
  try {
    const crawler = CrawlerFactory.createCrawler(platform) as LinkedInCrawler;
    crawler.run();
  } catch (err: any) {
    console.error(`❌ 크롤러 구동 실패: ${err.message}`);
    process.exit(1);
  }
}
