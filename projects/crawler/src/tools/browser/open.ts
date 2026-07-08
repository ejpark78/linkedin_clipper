/**
 * @module open
 * @description SOLID-compliant browser automation and session management tool for dump collection.
 * @constraints
 *   - Follows strict OOP patterns, SOLID principles, and clean error handling.
 * @dependencies playwright, fs, path
 * @lastUpdated 2026-06-16
 */

import { chromium, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { AppConfig } from "../../config/AppConfig";

// 📅 YYYY-MM-DD_HH-mm-ss 형식의 타임스탬프 생성 헬퍼
function getTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// 🌐 URL에서 www. 접두사를 제외한 도메인명 추출 헬퍼
function getDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.replace(/^www\./, "");
  } catch (e) {
    return "unknown";
  }
}

/**
 * Interface for session state loader and saver.
 */
export interface ISessionManager {
  loadSession(
    siteName: string,
    domainName: string,
  ): Promise<string | undefined>;
  saveSession(context: BrowserContext, domainName: string): Promise<void>;
}

/**
 * Interface for saving captured site data.
 */
export interface IDataCollector {
  saveHtml(domain: string, filename: string, content: string): Promise<string>;
  saveJson(domain: string, filename: string, content: string): Promise<string>;
}

/**
 * Concrete implementation of ISessionManager using local file system.
 */
export class LocalSessionManager implements ISessionManager {
  private readonly sessionDir: string;

  constructor() {
    this.sessionDir = path.resolve(process.cwd(), AppConfig.SESSION_DIR);
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  public async loadSession(
    siteName: string,
    domainName: string,
  ): Promise<string | undefined> {
    // 1. Domain-specific session (e.g. linkedin.com.json)
    const domainPath = path.join(this.sessionDir, `${domainName}.json`);
    if (fs.existsSync(domainPath)) {
      return domainPath;
    }
    // 2. Fallback to site name session (e.g. linkedin.json)
    const sitePath = path.join(this.sessionDir, `${siteName}.json`);
    if (fs.existsSync(sitePath)) {
      return sitePath;
    }
    return undefined;
  }

  public async saveSession(
    context: BrowserContext,
    domainName: string,
  ): Promise<void> {
    const sessionPath = path.join(this.sessionDir, `${domainName}.json`);
    await context.storageState({ path: sessionPath });
  }
}

/**
 * Concrete implementation of IDataCollector using local file system.
 */
export class LocalDataCollector implements IDataCollector {
  private readonly htmlBaseDir: string;
  private readonly jsonBaseDir: string;

  constructor() {
    this.htmlBaseDir = path.resolve(process.cwd(), AppConfig.BROWSER_HTML_DIR);
    this.jsonBaseDir = path.resolve(process.cwd(), AppConfig.BROWSER_JSON_DIR);

    if (!fs.existsSync(this.htmlBaseDir))
      fs.mkdirSync(this.htmlBaseDir, { recursive: true });
    if (!fs.existsSync(this.jsonBaseDir))
      fs.mkdirSync(this.jsonBaseDir, { recursive: true });
  }

  public async saveHtml(
    domain: string,
    filename: string,
    content: string,
  ): Promise<string> {
    const siteDir = path.join(this.htmlBaseDir, domain);
    if (!fs.existsSync(siteDir)) {
      fs.mkdirSync(siteDir, { recursive: true });
    }
    const savePath = path.join(siteDir, filename);
    fs.writeFileSync(savePath, content, "utf-8");
    return savePath;
  }

  public async saveJson(
    domain: string,
    filename: string,
    content: string,
  ): Promise<string> {
    const siteDir = path.join(this.jsonBaseDir, domain);
    if (!fs.existsSync(siteDir)) {
      fs.mkdirSync(siteDir, { recursive: true });
    }
    const savePath = path.join(siteDir, filename);
    fs.writeFileSync(savePath, content, "utf-8");
    return savePath;
  }
}

/**
 * Orchestrator engine to run the browser, listen to navigations/responses, and dump files.
 */
export class ClipperEngine {
  private currentDomain: string;
  private lastSavedContentLength: number = 0;
  private saveTimeout: NodeJS.Timeout | null = null;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly dataCollector: IDataCollector,
    private readonly startUrl: string = "https://www.linkedin.com",
  ) {
    this.currentDomain =
      AppConfig.SITE === "linkedin" ? "linkedin.com" : AppConfig.SITE;
  }

  public async run(): Promise<void> {
    console.log("🚀 [세션 브라우저 기동] 브라우저 인스턴스를 시작합니다...");

    const browser = await chromium.launch({
      headless: false,
      args: [
        "--start-maximized",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const contextOptions: any = {
      viewport: null,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
    };

    const sessionPath = await this.sessionManager.loadSession(
      AppConfig.SITE,
      this.currentDomain,
    );
    if (sessionPath) {
      contextOptions.storageState = sessionPath;
      console.log(
        `🔑 [세션 주입] 기존 세션 파일(${path.basename(sessionPath)})을 주입하여 기동합니다.`,
      );
    } else {
      console.log(
        `⚠️  [로그인 안됨] 세션 파일이 없습니다. 브라우저 내에서 직접 로그인을 진행해 주세요.`,
      );
    }

    const context = await browser.newContext(contextOptions);

    // Google OAuth 로그인 시 webdriver 감지 우회
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    const page = await context.newPage();

    // Register event listeners
    this.setupNavigationListener(page);
    this.setupResponseListener(page);
    this.startDomObserver(page);
    this.setupShutdownHooks(browser, context, page);

    // Go to start page
    console.log(
      `📡 [이동] ${this.startUrl} 으로 이동합니다. 자유롭게 브라우징 하세요.`,
    );
    await page.goto(this.startUrl, { waitUntil: "domcontentloaded" });

    // Keep running until page is closed
    await page.waitForEvent("close", { timeout: 0 });
  }

  private setupNavigationListener(page: Page): void {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        if (url === "about:blank") return;

        const domain = getDomain(url);
        if (domain && domain !== "unknown") {
          this.currentDomain = domain;
        }

        console.log(`🌐 [페이지 이동 감지] ➡️ URL: ${url}`);

        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
          this.triggerHtmlDump(page, url, "framenavigated");
        }, 1500);
      }
    });
  }

  private setupResponseListener(page: Page): void {
    page.on("response", async (response) => {
      try {
        const url = response.url();
        const status = response.status();

        if (status < 200 || status >= 300) return;

        const contentType = response.headers()["content-type"] || "";
        if (
          contentType.includes("application/json") ||
          url.includes("/api/") ||
          url.includes("/graphql")
        ) {
          const text = await response.text();
          try {
            JSON.parse(text); // Validate JSON
          } catch {
            return;
          }

          const timestamp = getTimestamp();
          let apiName = "api";
          try {
            const parsedUrl = new URL(url);
            apiName =
              parsedUrl.pathname.split("/").filter(Boolean).pop() || "api";
            const opName =
              parsedUrl.searchParams.get("operationName") ||
              parsedUrl.searchParams.get("queryId");
            if (opName) {
              apiName = `${apiName}_${opName}`;
            }
          } catch {}

          const filename = `${timestamp}_${apiName}.json`;
          const savePath = await this.dataCollector.saveJson(
            this.currentDomain,
            filename,
            text,
          );
          console.log(
            `📡 [비동기 API 수집] ➡️ ${path.relative(process.cwd(), savePath)} (${(text.length / 1024).toFixed(1)} KB)`,
          );
        }
      } catch {
        // Ignore errors from network disconnects on response reading
      }
    });
  }

  private startDomObserver(page: Page): void {
    this.intervalId = setInterval(async () => {
      try {
        if (page.isClosed()) return;
        const currentUrl = page.url();
        if (!currentUrl || currentUrl === "about:blank") return;

        const currentHtml = await page.content();
        const lengthDiff = Math.abs(
          currentHtml.length - this.lastSavedContentLength,
        );

        if (
          this.lastSavedContentLength > 0 &&
          lengthDiff / this.lastSavedContentLength > 0.15
        ) {
          console.log(
            `🔄 [비동기 데이터 갱신 감지] DOM 크기 변화가 감지되었습니다. (변화폭: ${(lengthDiff / 1024).toFixed(1)} KB)`,
          );
          await this.triggerHtmlDump(page, currentUrl, "dynamic_update");
        }
      } catch {
        // Ignore errors during browser shutdown
      }
    }, 6000);
  }

  private async triggerHtmlDump(
    page: Page,
    url: string,
    trigger: string,
  ): Promise<void> {
    try {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }

      try {
        await page.waitForLoadState("networkidle", { timeout: 3000 });
      } catch {}

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const htmlContent = await page.content();
      const timestamp = getTimestamp();

      let urlHint = "page";
      let domain = "unknown";
      try {
        domain = getDomain(url);
        const parsed = new URL(url);
        urlHint = parsed.pathname
          .replace(/[^a-zA-Z0-9]/g, "_")
          .substring(0, 30);
        if (!urlHint || urlHint === "_") urlHint = "home";
      } catch {}

      const filename = `${timestamp}_${urlHint}.html`;
      const savePath = await this.dataCollector.saveHtml(
        domain,
        filename,
        htmlContent,
      );
      console.log(
        `💾 [HTML 저장] (${trigger}) ➡️ ${path.relative(process.cwd(), savePath)} (${(htmlContent.length / 1024).toFixed(1)} KB)`,
      );

      this.lastSavedContentLength = htmlContent.length;
    } catch (err: any) {
      console.error(`⚠️ [HTML 저장 실패]: ${err.message}`);
    }
  }

  private setupShutdownHooks(
    browser: any,
    context: BrowserContext,
    page: Page,
  ): void {
    const cleanup = async (trigger: string) => {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }
      try {
        await this.sessionManager.saveSession(context, this.currentDomain);
        const savedPath = path.resolve(
          process.cwd(),
          AppConfig.SESSION_DIR,
          `${this.currentDomain}.json`,
        );
        console.log(`💾 [세션 백업 완료] (${trigger}) ➡️ ${savedPath}`);
      } catch (err: any) {
        console.error(`⚠️ [세션 백업 실패]: ${err.message}`);
      }
    };

    page.on("close", async () => {
      console.log("\n🚪 브라우저 페이지가 닫혔습니다.");
      await cleanup("page_close");
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log(
        "\n🛑 [프로세스 종료 신호 감지] 브라우저 종료 및 세션을 백업합니다...",
      );
      await cleanup("sigint");
      await browser.close();
      process.exit(0);
    });
  }
}

// 구동부
const sessionManager = new LocalSessionManager();
const dataCollector = new LocalDataCollector();
const engine = new ClipperEngine(sessionManager, dataCollector);

engine.run().catch((err) => {
  console.error(`❌ 브라우저 실행기 구동 중 심각한 오류 발생: ${err.message}`);
  process.exit(1);
});
