/**
 * @module BasePipeline
 * @description Core functionality or script runner for BasePipeline.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path, os, utils, ioredis
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DateUtils, FormatUtils } from "../utils";
import { AppConfig } from "../config/AppConfig";
import Redis from "ioredis";

export abstract class BasePipeline<TMeta> {
  // 🔒 동시 워커 간 중복 수집 타겟 선점 방지용 인메모리 뮤텍스 셋
  private readonly processingIds = new Set<string>();

  constructor() {}

  // 🛡️ 하위 클래스에서 재정의할 추상 훅 메서드들
  protected abstract extractId(url: string): string;
  protected abstract getDomainName(): string; // "채용공고" 또는 "회사정보"
  protected abstract executeScrape(
    url: string,
    tempHtmlPath: string,
  ): Promise<void>;
  protected abstract processMetadata(
    htmlContent: string,
    id: string,
    url: string,
  ): TMeta | Promise<TMeta>;
  protected abstract saveResults(
    meta: TMeta,
    id: string,
    tempHtmlPath: string,
    redisInstance?: Redis | null,
  ): Promise<{ targetDirName: string }>;

  /**
   * 🚀 개별 URL 단일 수집 기동용 공개 메서드 (Redis 워커 등 외부 큐 연동용)
   */
  public async processSingleUrl(
    url: string,
    redisInstance?: Redis | null,
  ): Promise<string | null> {
    const id = this.extractId(url);
    if (!id) return null;

    const tempHtmlPath = path.join(os.tmpdir(), `temp_${id}.html`);

    try {
      await this.executeScrape(url, tempHtmlPath);

      if (
        !fs.existsSync(tempHtmlPath) ||
        fs.statSync(tempHtmlPath).size === 0
      ) {
        console.error(`❌ [ID: ${id}] HTML을 정상적으로 가져오지 못했습니다.`);
        if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
        return null;
      }

      const htmlContent = fs.readFileSync(tempHtmlPath, "utf-8");
      const meta = await this.processMetadata(htmlContent, id, url);
      const result = await this.saveResults(
        meta,
        id,
        tempHtmlPath,
        redisInstance,
      );

      console.log(`✨ [성공] ID: ${id} | 분류: ${result.targetDirName}`);
      return id;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`❌ 대상 ${id} 처리 도중 오류 발생: ${errorMsg}`);
      if (fs.existsSync(tempHtmlPath)) {
        fs.unlinkSync(tempHtmlPath);
      }
      throw err;
    }
  }

  /**
   * 🚀 파이프라인 구동 메인 템플릿 메서드
   */
  public async run(urlsFile?: string): Promise<void> {
    let origCount = 0;
    const filteredUrls: string[] = [];
    const processedIds = new Set<string>(); // 파일 내부 중복 차단

    if (urlsFile) {
      if (!fs.existsSync(urlsFile)) {
        console.error(
          `❌ ${this.getDomainName()} URL 목록 파일을 찾을 수 없습니다: ${urlsFile}`,
        );
        process.exit(1);
      }
      console.log(
        `🚀 [시작] ${urlsFile} 기반 ${this.getDomainName()} 정보 수집 및 백업 자동화 파이프라인 가동`,
      );
    } else {
      console.log(
        `🚀 [시작] MongoDB 기반 ${this.getDomainName()} 정보 수집 및 백업 자동화 파이프라인 가동`,
      );
    }

    // 로그인 상태 확인
    const useLoginEnv = AppConfig.USE_LOGIN;
    const sessionPath = path.join(
      __dirname,
      "..",
      "..",
      "data",
      "sessions",
      "linkedin.json",
    );
    const loginStatus = useLoginEnv
      ? fs.existsSync(sessionPath)
        ? "[AUTHED]"
        : "[UNAUTHED]"
      : "[UNAUTHED]";

    // 0. Redis 연동 및 캐시 로드
    const redisUrl = AppConfig.REDIS_URL;
    let redis: Redis | null = null;
    let useRedisCache = false;
    try {
      const Redis = require("ioredis");
      redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          redis.disconnect();
          reject(new Error("Connection Timeout"));
        }, 1500);
        redis.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      useRedisCache = true;
      console.log(
        `📡 [Redis Cache] Redis 연결 성공 (${redisUrl}). 실시간 분산 캐시를 사용합니다.`,
      );
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn(
        `⚠️ [Redis Cache Warning] Redis 연결 실패. 데이터베이스 스캔으로 대체합니다: ${errorMsg}`,
      );
    }

    // 1. 캐시 로드 및 구축 (Redis 우선 사용)
    const cacheSet = new Set<string>();
    let redisLoadedCount = 0;

    // Redis 캐시가 활성화된 경우 Redis에서 먼저 로드
    if (useRedisCache) {
      try {
        const redisMembers = await redis.smembers("completed_jobs");
        redisMembers.forEach((id: string) => {
          if (id && /^\d+$/.test(id)) {
            cacheSet.add(id);
          }
        });
        redisLoadedCount = cacheSet.size;
        if (redisLoadedCount > 0) {
          console.log(
            `📡 [Redis Cache] Redis 'completed_jobs'에서 ${FormatUtils.formatThousand(redisLoadedCount)}개의 캐시를 로드하여 DB 스캔을 건너뜁니다.`,
          );
        }
      } catch (err: any) {
        console.error(`⚠️ Redis 캐시 로드 실패: ${err.message}`);
      }
    }

    // Redis 캐시가 비어있거나 Redis를 사용할 수 없는 경우에만 MongoDB 조회 수행 (Fallback)
    if (cacheSet.size === 0) {
      try {
        console.log(
          `🔍 [DB Cache] Redis 캐시가 비어있거나 연결할 수 없어 MongoDB를 스캔합니다...`,
        );
        const { MongoDatabase } = require("../database/mongo");
        const dbInstance = MongoDatabase.getInstance();

        if (this.getDomainName() === "채용공고") {
          const bronzeJobs = await dbInstance.getCollection(
            "bronze/linkedin.jobs",
          );
          const jobIds = await bronzeJobs.distinct("jobId");
          jobIds.forEach((jobId: any) => {
            if (jobId && /^\d+$/.test(jobId)) {
              cacheSet.add(jobId);
            }
          });
        } else {
          const bronzeCompanies = await dbInstance.getCollection(
            "bronze/linkedin.companies",
          );
          const companyIds = await bronzeCompanies.distinct("companyId");
          companyIds.forEach((companyId: any) => {
            if (companyId) {
              cacheSet.add(companyId);
            }
          });
        }
        console.log(
          `✅ 총 ${FormatUtils.formatThousand(cacheSet.size)} 개의 기존 수집 완료 정보를 MongoDB에서 로드했습니다.`,
        );
      } catch (err: any) {
        console.error(`⚠️ MongoDB 캐시 로드 실패: ${err.message}`);
      }

      // DB에서 수집한 캐시를 Redis에 백업 동기화
      if (useRedisCache && cacheSet.size > 0) {
        try {
          const pipeline = redis.pipeline();
          cacheSet.forEach((id) => {
            pipeline.sadd("completed_jobs", id);
          });
          await pipeline.exec();
          console.log(
            `📡 [Redis Cache] DB 캐시 ${cacheSet.size}개를 Redis 'completed_jobs'에 동기화 완료.`,
          );
        } catch (err: any) {
          console.error(`⚠️ Redis 캐시 동기화 실패: ${err.message}`);
        }
      }
    }

    // 2. urlsFile 에서 고유 대상 URL 로드 및 필터링
    if (urlsFile) {
      if (urlsFile.endsWith(".json")) {
        try {
          const jobsList = JSON.parse(fs.readFileSync(urlsFile, "utf-8"));
          origCount = jobsList.length;

          // config.json에서 target locations 및 geo_enable 로드
          let targetLocations = [
            "South Korea",
            "United Arab Emirates",
            "Japan",
          ];
          let geoEnable = true;
          try {
            const configPath = path.join(
              __dirname,
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
          } catch (e) {}

          jobsList.forEach((job: any) => {
            // 오직 DIRECT 소스이고 (geo_enable이 비활성화되었거나 타겟 국가에 매칭되는) 건들 중 아직 캐시에 없는 건만 대기열에 추가
            if (
              job.source === "DIRECT" &&
              (!geoEnable || targetLocations.includes(job.geo))
            ) {
              const id = job.jobId;
              if (!id) return;
              if (!cacheSet.has(id) && !processedIds.has(id)) {
                filteredUrls.push(
                  job.url || `https://www.linkedin.com/jobs/view/${id}`,
                );
                processedIds.add(id);
              }
            }
          });
        } catch (jsonErr: any) {
          console.error(`❌ JSON 파일 파싱 실패: ${jsonErr.message}`);
          process.exit(1);
        }
      } else {
        const rawLines = fs.readFileSync(urlsFile, "utf-8").split(/\r?\n/);
        origCount = rawLines.filter(
          (l) => l.trim() && !l.trim().startsWith("#"),
        ).length;

        rawLines.forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return;

          const id = this.extractId(trimmed);
          if (!id) return;

          if (!cacheSet.has(id) && !processedIds.has(id)) {
            filteredUrls.push(trimmed);
            processedIds.add(id);
          }
        });
      }
    } else {
      // DB 기반 회사 정보 URL 동적 로드
      try {
        const { MongoDatabase } = require("../database/mongo");
        const dbInstance = MongoDatabase.getInstance();
        const companyUrlsColl = await dbInstance.getCollection(
          "bronze/linkedin.company_urls",
        );

        // 아직 완료되지 않았거나 신규 수집 상태의 모든 URL을 로드
        const companyUrlsCursor = companyUrlsColl.find({
          status: { $ne: "completed" },
        });
        origCount = 0;
        for await (const doc of companyUrlsCursor) {
          origCount++;
          if (doc.url) {
            const id = this.extractId(doc.url);
            if (id && !cacheSet.has(id) && !processedIds.has(id)) {
              filteredUrls.push(doc.url);
              processedIds.add(id);
            }
          }
        }
      } catch (err: any) {
        console.error(
          `❌ MongoDB에서 회사 수집 대상 URL 로드 실패: ${err.message}`,
        );
        process.exit(1);
      }
    }

    const filteredCount = filteredUrls.length;
    console.log(
      `📊 전체 대상: ${FormatUtils.formatThousand(origCount)}건 | 신규 처리 대상: ${FormatUtils.formatThousand(filteredCount)}건`,
    );

    if (filteredCount === 0) {
      console.log(
        `🎉 [종료] 모든 ${this.getDomainName()} 정보가 이미 수집되었습니다.`,
      );
      if (redis) await redis.quit();
      process.exit(0);
    }

    const startTime = Date.now();
    let currentIndex = 0;

    // 개별 워커 실행 함수
    const worker = async (url: string) => {
      const id = this.extractId(url);
      if (!id) return;

      // 🛡️ 실시간 중복 수집 선점 차단 뮤텍스 검사
      if (this.processingIds.has(id)) {
        return;
      }
      this.processingIds.add(id);

      currentIndex++;
      const myIndex = currentIndex;

      // 💤 [대기] 다음 요청까지 슬랙타임 대기
      const sleepSec = AppConfig.LIST_SLACK;
      if (myIndex > 1 && sleepSec > 0) {
        console.log(
          `💤 [대기] 다음 ${this.getDomainName()} 요청까지 ${sleepSec}초 대기 중...`,
        );
        await new Promise((resolve) => setTimeout(resolve, sleepSec * 1000));
      }

      // 진행률 및 ETR 계산
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      const runtimeStr = DateUtils.formatSeconds(elapsedSeconds);

      let etrStr = "계산 중...";
      if (myIndex > 1) {
        const completedCount = myIndex - 1;
        const remainingCount = filteredCount - completedCount;
        const avgSpeed = elapsedSeconds / completedCount;
        const remainingSeconds = Math.floor(avgSpeed * remainingCount);
        etrStr = DateUtils.formatSeconds(remainingSeconds);
      }

      const currentIndexFmt = FormatUtils.formatThousand(myIndex);
      const filteredCountFmt = FormatUtils.formatThousand(filteredCount);

      console.log(`\n──────────────────────────────────────────────────`);
      console.log(
        `🏢 [${currentIndexFmt}/${filteredCountFmt}][${runtimeStr}/${etrStr}] ${loginStatus} ID: ${id} | 시작`,
      );
      console.log(`──────────────────────────────────────────────────`);

      const tempHtmlPath = path.join(os.tmpdir(), `temp_${id}.html`);

      try {
        // 1) HTML 스크래핑
        await this.executeScrape(url, tempHtmlPath);

        if (
          !fs.existsSync(tempHtmlPath) ||
          fs.statSync(tempHtmlPath).size === 0
        ) {
          console.error(
            `❌ [ID: ${id}] HTML을 정상적으로 가져오지 못했습니다.`,
          );
          if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
          this.processingIds.delete(id);
          return;
        }

        // 2) 핵심 정보 파싱 및 변환
        const htmlContent = fs.readFileSync(tempHtmlPath, "utf-8");
        const meta = await this.processMetadata(htmlContent, id, url);

        // 3) 최종 파일 저장
        const result = await this.saveResults(meta, id, tempHtmlPath);

        console.log(`✨ [성공] ID: ${id} | 분류: ${result.targetDirName}`);

        // Redis 캐시 추가 및 메모리 캐시 갱신
        cacheSet.add(id);
        if (useRedisCache) {
          redis.sadd("completed_jobs", id).catch(() => {});
        }
      } catch (err: any) {
        console.error(`❌ 대상 ${id} 처리 도중 오류 발생: ${err.message}`);
        if (fs.existsSync(tempHtmlPath)) {
          fs.unlinkSync(tempHtmlPath);
        }

        // 세션 만료 및 Auth Wall(로그인 창) 감지 시 전체 파이프라인 중단 처리
        if (
          err.message &&
          (err.message.includes("세션 만료") ||
            err.message.includes("Auth Wall") ||
            err.message.includes("로그인 요청"))
        ) {
          if (useLoginEnv) {
            console.error(
              `\n🛑 [핵심 차단] 링크드인 로그인 세션이 만료되었거나 풀렸습니다.`,
            );
            console.error(`💡 [해결 방법]:`);
            console.error(
              `   1. 터미널에 [task app:crawler:login]을 다시 실행하여 링크드인 브라우저 로그인을 갱신해 주세요.`,
            );
            console.error(
              `   2. 완료되면 다시 파이프라인을 기동하시면 중단된 지점부터 이어서 수집이 가능해집니다.\n`,
            );
            if (redis) await redis.quit();
            process.exit(1);
          } else {
            console.warn(
              `⚠️ [경고] 비로그인 상태에서 Auth Wall(로그인 요구)을 감지했습니다. 전체 중단 없이 다음 URL로 넘어갑니다.`,
            );
          }
        }
      } finally {
        // 🔒 뮤텍스 락 해제
        this.processingIds.delete(id);
      }
    };

    for (const url of filteredUrls) {
      await worker(url);
    }

    // 🔌 MongoDB 및 Redis 연결 종료 처리
    try {
      const { MongoDatabase } = require("../database/mongo");
      const dbInstance = MongoDatabase.getInstance();
      await dbInstance.close();
    } catch (e) {}

    if (redis) {
      await redis.quit();
    }

    console.log(
      `\n🎉 [종료] ${this.getDomainName()} 정보 일괄 수집 완료! (MongoDB 데이터베이스에 저장됨)`,
    );
    process.exit(0);
  }
}
