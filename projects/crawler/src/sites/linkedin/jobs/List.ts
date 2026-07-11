/**
 * @module List
 * @description Core functionality or script runner for List.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies playwright, fs, path, UrlManager, utils
 * @lastUpdated 2026-06-11
 */

import { chromium, Browser } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { descriptor, Config } from "./site.config";
import { HtmlMinifier, DateUtils, UrlUtils, Logger } from "../../../utils";
import { MongoDatabase } from "../../../database/mongo";
import { AppConfig } from "../../../config/AppConfig";
import Redis from "ioredis";

export class LinkedInList {
  private readonly sessionPath: string = path.join(
    AppConfig.SESSION_DIR,
    "linkedin.json",
  );
  private readonly useLogin: boolean;
  private readonly listSlack: number;
  private readonly priority: string;

  constructor(options: { listSlack?: number; priority?: string } = {}) {
    this.useLogin = AppConfig.USE_LOGIN;
    this.listSlack = options.listSlack ?? AppConfig.LIST_SLACK;
    this.priority = options.priority ?? AppConfig.PRIORITY;
  }

  private async autoScroll(page: any): Promise<void> {
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

      let container: HTMLElement | null = null;
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) {
          container = (el.closest('[class*="scroll"]') ||
            el.closest('[class*="list"]') ||
            el) as HTMLElement;
          break;
        }
      }

      const scrollTarget = container || window;

      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 120;
        const timer = setInterval(() => {
          const scrollHeight =
            scrollTarget instanceof Window
              ? document.body.scrollHeight
              : scrollTarget.scrollHeight;

          if (scrollTarget instanceof Window) {
            window.scrollBy(0, distance);
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

  public async scrapeList(configFilePath: string): Promise<void> {
    const isLoggedIn = this.useLogin && fs.existsSync(this.sessionPath);
    if (!isLoggedIn) {
      console.log(
        "⚠️  [안내] 로그인 세션 파일(linkedin.json)이 발견되지 않았거나 login 옵션이 활성화되지 않아 비로그인(Public) 모드로 동작합니다.",
      );
      console.log(
        "💡 direct_urls는 수집 대상에서 자동으로 제외되며, 일반 검색 결과 수집만 진행합니다.",
      );
    }

    if (!fs.existsSync(configFilePath)) {
      throw new Error(
        `지정한 입력 대상 설정 파일을 찾을 수 없습니다: ${configFilePath}`,
      );
    }

    console.log("🚀 [시작] 링크드인 채용 목록 백그라운드 수집을 시작합니다.");

    const ext = path.extname(configFilePath).toLowerCase();
    let urls: string[] = [];

    if (ext === ".json") {
      const config: Config = JSON.parse(
        fs.readFileSync(configFilePath, "utf-8"),
      );
      if (descriptor.scraper?.generateUrls) {
        urls = descriptor.scraper.generateUrls(config as any, {
          skipDirectUrls: !isLoggedIn,
        });
      }
    } else {
      urls = fs
        .readFileSync(configFilePath, "utf-8")
        .split(/\r?\n/)
        .map((line) => {
          let clean = line.trim();
          if (clean.endsWith("\\")) {
            clean = clean.slice(0, -1).trim();
          }
          return clean;
        })
        .filter(
          (line) =>
            line.length > 0 && !line.startsWith("#") && line.startsWith("http"),
        );
    }

    if (urls.length === 0) {
      console.log(
        "💡 [안내] 수집할 채용 목록 URL이 없습니다. config.json 또는 config.list 내용을 확인해 주세요.",
      );
      return;
    }

    console.log(`📋 총 ${urls.length} 개의 목록 URL이 감지되었습니다.`);

    const isHeadless = AppConfig.HEADLESS;
    const browser: Browser = await chromium.launch({
      headless: isHeadless,
      args: ["--disable-blink-features=AutomationControlled"],
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

      const loginStatus = isLoggedIn ? "[AUTHED]" : "[UNAUTHED]";
      const startTime = Date.now();
      let currentIndex = 0;

      const runDate = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const batchFolderName = `${runDate.getFullYear()}${pad(runDate.getMonth() + 1)}${pad(runDate.getDate())}_${pad(runDate.getHours())}${pad(runDate.getMinutes())}${pad(runDate.getSeconds())}`;

      const finishedQueries = new Set<string>();

      const getBaseQueryKey = (urlStr: string): string => {
        try {
          const u = new URL(urlStr);
          u.searchParams.delete("start");
          return u.toString();
        } catch (e) {
          return urlStr;
        }
      };

      const worker = async (url: string) => {
        const baseKey = getBaseQueryKey(url);
        if (finishedQueries.has(baseKey)) {
          console.log(
            `⏭️  [조기 종료] 이전 페이지에 결과가 없어 수집을 건너뜁니다: ${decodeURIComponent(url)}`,
          );
          return;
        }

        currentIndex++;
        const myIndex = currentIndex;

        const d = new Date();
        const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}_${Math.random().toString(36).substring(2, 6)}`;

        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        const runtimeStr = DateUtils.formatSeconds(elapsedSeconds);

        let etrStr = "계산 중...";
        if (myIndex > 1) {
          const completedCount = myIndex - 1;
          const remainingCount = urls.length - completedCount;
          const avgSpeed = elapsedSeconds / completedCount;
          const remainingSeconds = Math.floor(avgSpeed * remainingCount);
          etrStr = DateUtils.formatSeconds(remainingSeconds);
        }

        console.log(`\n──────────────────────────────────────────────────`);
        console.log(
          `📡 [${myIndex}/${urls.length}][${runtimeStr}/${etrStr}]${loginStatus} 목록 수집 중: ${decodeURIComponent(url)}`,
        );
        console.log(`──────────────────────────────────────────────────`);

        const context = await browser.newContext(contextOptions);
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
          });
        });
        const page = await context.newPage();

        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          await new Promise((resolve) => setTimeout(resolve, 3000));

          const title = await page.title();
          if (
            title.includes("Sign In") ||
            title.includes("로그인") ||
            title.includes("Security Challenge")
          ) {
            console.error(
              "⚠️  [경고] 로그인 또는 보안 인증(Captcha) 화면이 감지되었습니다.",
            );
            throw new Error("AUTH_FAIL");
          }

          const contentForCheck = await page.content();
          const cheerioForCheck = require("cheerio");
          const $check = cheerioForCheck.load(contentForCheck);

          const noJobsText = $check("main, body").text().toLowerCase();
          const hasNoMatchingMsg =
            noJobsText.includes("no matching jobs found") ||
            noJobsText.includes("검색 결과와 일치하는 채용") ||
            noJobsText.includes("no jobs found");

          const jobCardsCount = $check(
            'div[data-job-id], li [data-job-id], a[href*="/jobs/view/"]',
          ).length;

          if (hasNoMatchingMsg || jobCardsCount === 0) {
            console.log(
              `💡 [조기 종료 마킹] 해당 검색 조건의 채용 공고가 없거나 끝에 도달했습니다. (검색어 카드 개수: ${jobCardsCount}개)`,
            );
            finishedQueries.add(baseKey);
            return;
          }

          await this.autoScroll(page);

          const htmlContent = await page.content();
          const minifiedHtml = await HtmlMinifier.minify(htmlContent);

          try {
            const dbInstance = MongoDatabase.getInstance();
            const listCollName =
              descriptor.listsCollectionName || "bronze/linkedin.lists";
            const bronzeLists = await dbInstance.getCollection(
              listCollName as any,
            );
            await bronzeLists.updateOne(
              { listId: timestamp },
              {
                $set: {
                  listId: timestamp,
                  listUrl: url,
                  rawHtml: minifiedHtml,
                  batchId: batchFolderName,
                  collectedAt: new Date(),
                },
              },
              { upsert: true },
            );
            console.log(
              `📡 [MongoDB Write] Successfully saved List ID ${timestamp} to bronze/linkedin.lists. (${(minifiedHtml.length / 1024).toFixed(1)} KB)`,
            );

            await this.extractAndPushJobs(minifiedHtml, url);
          } catch (dbErr: any) {
            console.error(
              `❌ [MongoDB Write Error] Failed to write list to DB: ${dbErr.message}`,
            );
          }

          if (isLoggedIn) {
            await context.storageState({ path: this.sessionPath });
          }
        } finally {
          await context.close();
        }
      };

      let authFailed = false;

      let isFirst = true;
      for (const url of urls) {
        if (authFailed) break;

        const baseKey = getBaseQueryKey(url);
        if (finishedQueries.has(baseKey)) {
          continue;
        }

        if (this.useLogin && !isFirst) {
          if (this.listSlack > 0) {
            console.log(`💤 [대기] 다음 요청까지 ${this.listSlack}초 대기 중...`);
            await new Promise((resolve) =>
              setTimeout(resolve, this.listSlack * 1000),
            );
          }
        }
        isFirst = false;

        try {
          await worker(url);
        } catch (err: any) {
          if (err.message === "AUTH_FAIL") {
            authFailed = true;
          } else {
            console.error(`⚠️ URL 수집 실패 (${url}): ${err.message}`);
          }
        }
      }

      if (authFailed) {
        console.log(
          "\n🛑 로그인 세션 또는 인증 오류로 인해 작업을 중단했습니다.",
        );
      } else {
        console.log(
          "\n🎉 모든 목록 URL의 무인 백그라운드 수집을 정상적으로 마쳤습니다!",
        );
      }
    } finally {
      await browser.close();
    }
  }

  private async extractAndPushJobs(
    htmlContent: string,
    listUrl: string,
  ): Promise<void> {
    try {
      console.log(
        `🔍 [Auto-Extract] Extracting job URLs from list: ${decodeURIComponent(listUrl)}`,
      );
      const cheerio = require("cheerio");
      const $ = cheerio.load(htmlContent);
      const dbInstance = MongoDatabase.getInstance();
      const jobUrlsCollName =
        descriptor.converter?.statusCollection || "bronze/linkedin.job_urls";
      const companyUrlsCollName =
        descriptor.companyUrlsCollectionName || "bronze/linkedin.company_urls";
      const jobsCollName =
        descriptor.scraper?.collectionName || "bronze/linkedin.jobs";

      const jobUrlsColl = await dbInstance.getCollection(
        jobUrlsCollName as any,
      );
      const companyUrlsColl = await dbInstance.getCollection(
        companyUrlsCollName as any,
      );
      const bronzeJobs = await dbInstance.getCollection(jobsCollName as any);

      const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
      const redis = new Redis(redisUrl);

      let targetLocations = ["South Korea", "United Arab Emirates", "Japan"];
      let geoEnable = true;
      try {
        const configPath = path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "config",
          "config.json",
        );
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          if (
            config.global_settings &&
            config.global_settings.geo_enable !== undefined
          ) {
            geoEnable = config.global_settings.geo_enable;
          }
          if (config.search_targets) {
            targetLocations = config.search_targets
              .filter((t: any) => t.enabled !== false)
              .map((t: any) => t.location);
          }
        }
      } catch (e: any) {}

      let countryMapping: Record<string, string[]> = {};
      try {
        const countryJsonPath = path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "config",
          "country.json",
        );
        if (fs.existsSync(countryJsonPath)) {
          countryMapping = JSON.parse(
            fs.readFileSync(countryJsonPath, "utf-8"),
          );
        }
      } catch (e: any) {}

      const parseGeo = (loc: string): string => {
        const std = UrlUtils.standardizeLocation(loc);
        if (std === "unknown-location") return "Others";
        for (const country of Object.keys(countryMapping)) {
          if (std.toLowerCase() === country.toLowerCase()) return country;
        }
        return "Others";
      };

      // Memory-friendly inline database check will be used inside the loop instead of pre-loading 83k+ entries.

      const foundJobs: any[] = [];
      const allDiscovered: any[] = [];
      $('a[href*="/jobs/view/"]').each((_: any, el: any) => {
        const href = $(el).attr("href") || "";
        const jobId = UrlUtils.extractJobId(href);
        if (!jobId || !/^\d+$/.test(jobId)) return;

        const title = $(el).text().replace(/\s+/g, " ").trim();
        if (!title || title.length < 2) return;

        if (allDiscovered.some((j) => j.jobId === jobId)) return;

        let company = "정보 없음";
        let location = "정보 없음";

        const parent = $(el).closest("li");
        if (parent.length > 0) {
          const companyText = parent
            .find(
              '[class*="company"], [class*="subtitle"], [class*="secondary"]',
            )
            .first()
            .text()
            .replace(/\s+/g, " ")
            .trim();
          if (companyText) company = companyText;
          const locText = parent
            .find('[class*="location"], [class*="metadata"]')
            .first()
            .text()
            .replace(/\s+/g, " ")
            .trim();
          if (locText) {
            location = locText
              .split(/\d+\s+days?\s+ago|\d+\s+weeks?\s+ago/i)[0]
              .trim();
          }
        }

        const geo = parseGeo(location);
        const matchesTarget = !geoEnable || targetLocations.includes(geo);

        const jobMeta = {
          jobId,
          title,
          company,
          location,
          geo,
          matchesTarget,
          url: `https://www.linkedin.com/jobs/view/${jobId}`,
        };
        allDiscovered.push(jobMeta);

        if (matchesTarget) {
          foundJobs.push(jobMeta);
        }
      });

      if (allDiscovered.length > 0) {
        console.log(
          `📋 [Auto-Extract] Discovered ${allDiscovered.length} jobs in HTML:`,
        );
        allDiscovered.forEach((j, index) => {
          console.log(
            `  [Card ${index + 1}] ID: ${j.jobId} | Title: ${j.title} | Company: ${j.company} | Location: ${j.location} | Geo: ${j.geo} | Matches Target: ${j.matchesTarget}`,
          );
        });
      }

      const companyHrefRegex = /href="([^"]*\/comp(?:any|ay)\/[^"]*)"/g;
      let compMatch;
      companyHrefRegex.lastIndex = 0;
      while ((compMatch = companyHrefRegex.exec(htmlContent)) !== null) {
        let url = compMatch[1].trim().split("?")[0].replace(/\/$/, "");
        if (url.startsWith("/company") || url.startsWith("/compay")) {
          url = "https://www.linkedin.com" + url;
        }
        if (
          url.startsWith("http") &&
          (url.includes("/company/") || url.includes("/compay/"))
        ) {
          const companyId = UrlUtils.extractCompanyId(url);
          if (companyId) {
            await companyUrlsColl.updateOne(
              { companyId },
              {
                $set: {
                  companyId,
                  url: `https://www.linkedin.com/company/${companyId}`,
                  status: "new",
                  updatedAt: new Date(),
                },
                $setOnInsert: { pushedToRedis: false },
              },
              { upsert: true },
            );
          }
        }
      }

      let pushedCount = 0;
      const newJobsColl = await dbInstance.getCollection(jobsCollName as any);
      for (const job of allDiscovered) {
        const isCompleted =
          (await bronzeJobs.findOne(
            { jobId: job.jobId },
            { projection: { _id: 1 } },
          )) !== null ||
          (await newJobsColl.findOne(
            { jobId: job.jobId },
            { projection: { _id: 1 } },
          )) !== null;
        const currentDoc = await jobUrlsColl.findOne({ jobId: job.jobId });
        const alreadyPushed = currentDoc?.pushedToRedis === true;

        await jobUrlsColl.updateOne(
          { jobId: job.jobId },
          {
            $set: {
              jobId: job.jobId,
              url: job.url,
              title: job.title,
              company: job.company,
              location: job.location,
              geo: job.geo,
              source: "DIRECT",
              status: isCompleted ? "completed" : "new",
              updatedAt: new Date(),
            },
            $setOnInsert: {
              pushedToRedis: isCompleted || !job.matchesTarget ? true : false,
            },
          },
          { upsert: true },
        );

        if (job.matchesTarget && !isCompleted && !alreadyPushed) {
          const scrapeTask = {
            site: "linkedin",
            url: job.url,
            attempt: 1,
            priority: this.priority,
          };
          await redis.rpush(
            `sites:linkedin:scrape:${this.priority}`,
            JSON.stringify(scrapeTask),
          );
          await jobUrlsColl.updateOne(
            { jobId: job.jobId },
            { $set: { pushedToRedis: true } },
          );
          pushedCount++;
        } else if (!job.matchesTarget) {
          await jobUrlsColl.updateOne(
            { jobId: job.jobId },
            { $set: { pushedToRedis: false } },
          );
        }
      }
      if (foundJobs.length > 0) {
        console.log(
          `📋 [Auto-Extract Target] Matched target jobs:\n${JSON.stringify(
            foundJobs.map((j) => ({
              jobId: j.jobId,
              title: j.title,
              geo: j.geo,
            })),
            null,
            2,
          )}`,
        );
      }
      console.log(
        `✅ [Auto-Extract] Extracted ${foundJobs.length} target jobs. Pushed ${pushedCount} new jobs to Redis scrape_queue.`,
      );
      await redis.quit();
    } catch (err: any) {
      console.error(
        `❌ [Auto-Extract Error] Failed to extract/push: ${err.message}`,
      );
    }
  }
}

if (require.main === module) {
  let configFile = process.argv[2] || "config/config.json";
  if (configFile && /^\d+$/.test(configFile)) {
    configFile = "config/config.json";
  }
  const scraper = new LinkedInList();

  const mongo = MongoDatabase.getInstance();
  mongo.connect().then(() => {
    scraper
      .scrapeList(configFile)
      .catch((err) => {
        console.error("💥 Fatal error during List Scraping execution", err);
        process.exit(1);
      })
      .finally(() => {
        mongo.close().then(() => process.exit(0));
      });
  });
}
