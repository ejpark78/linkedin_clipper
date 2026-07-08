/**
 * @module Converter
 * @description Core functionality or script runner for Converter.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path, cheerio, prettier, utils
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { BaseConverter } from "../../../core/BaseConverter";
import { UrlUtils } from "../../../utils/UrlUtils";
import { DateUtils } from "../../../utils/DateUtils";
import { NamingUtils } from "../../../utils/NamingUtils";
import { IConverter } from "../../../core/IConverter";

import { JobMeta } from "./site.config";

export class LinkedInMarkdownConverter extends BaseConverter<JobMeta> {
  /**
   * DOM 엘리먼트를 마크다운으로 정밀 파싱하는 private 재귀 도구
   */
  private elementToMarkdown($: cheerio.CheerioAPI, el: any): string {
    let markdown = "";
    const tagName = el.name;
    if (
      tagName === "script" ||
      tagName === "style" ||
      tagName === "button" ||
      tagName === "icon" ||
      tagName === "svg"
    ) {
      return "";
    }

    $(el)
      .contents()
      .each((_, child: any) => {
        if (child.type === "text") {
          markdown += $(child).text();
        } else if (child.type === "tag") {
          const childTagName = child.name;
          const childNode = $(child);

          if (childTagName === "br") {
            markdown += "\n";
          } else if (childTagName === "strong" || childTagName === "b") {
            const rawInner = this.elementToMarkdown($, child);
            const trimmedInner = rawInner.trim();
            if (trimmedInner) {
              const leadingSpace = rawInner.match(/^\s*/)?.[0] || "";
              const trailingSpace = rawInner.match(/\s*$/)?.[0] || "";
              markdown += `${leadingSpace}**${trimmedInner}**${trailingSpace}`;
            }
          } else if (childTagName === "em" || childTagName === "i") {
            const rawInner = this.elementToMarkdown($, child);
            const trimmedInner = rawInner.trim();
            if (trimmedInner) {
              const leadingSpace = rawInner.match(/^\s*/)?.[0] || "";
              const trailingSpace = rawInner.match(/\s*$/)?.[0] || "";
              markdown += `${leadingSpace}*${trimmedInner}*${trailingSpace}`;
            }
          } else if (childTagName === "p") {
            const inner = this.elementToMarkdown($, child).trim();
            if (inner) {
              markdown += `\n\n${inner}\n\n`;
            }
          } else if (childTagName === "li") {
            const inner = this.elementToMarkdown($, child).trim();
            if (inner) {
              markdown += `\n- ${inner}`;
            }
          } else if (childTagName.match(/^h[1-6]$/)) {
            const level = parseInt(childTagName.substring(1));
            const inner = this.elementToMarkdown($, child).trim();
            if (inner) {
              markdown += `\n\n${"#".repeat(level)} ${inner}\n\n`;
            }
          } else if (childTagName === "a") {
            const href = childNode.attr("href") || "";
            const rawInner = this.elementToMarkdown($, child);
            const trimmedInner = rawInner.trim();
            if (trimmedInner) {
              const leadingSpace = rawInner.match(/^\s*/)?.[0] || "";
              const trailingSpace = rawInner.match(/\s*$/)?.[0] || "";
              markdown += `${leadingSpace}[${trimmedInner}](${href})${trailingSpace}`;
            }
          } else if (childTagName === "ul" || childTagName === "ol") {
            markdown += `\n${this.elementToMarkdown($, child)}\n`;
          } else {
            markdown += this.elementToMarkdown($, child);
          }
        }
      });

    return markdown;
  }

  /**
   * 🌟 HTML 원본 데이터 파싱 및 메타 요약 정보 객체 빌드 함수 (In-memory Core)
   */
  public async convertHtmlToMarkdown(
    htmlContent: string,
    id: string,
    url: string,
    baseDateInput?: Date,
  ): Promise<JobMeta> {
    const $ = cheerio.load(htmlContent);
    let jobId = id;

    // 🛡️ 극강 강건성: canonical link와 파일명에서 모두 ID가 안 찾아질 때를 대비한 HTML 분석 폴백
    if (!jobId || jobId === "정보 없음") {
      const canonicalHref = $('link[rel="canonical"]').attr("href") || "";
      const match = canonicalHref.match(/(\d+)$/);
      if (match) {
        jobId = match[1];
      }
    }

    if (!jobId || jobId === "정보 없음") {
      // A. /jobs/view/ 또는 /view/ 링크에서 ID 추출 시도
      $('a[href*="/jobs/view/"], a[href*="/view/"]').each((_, el) => {
        const href = $(el).attr("href") || "";
        const extracted = UrlUtils.extractJobId(href);
        if (extracted && /^\d+$/.test(extracted)) {
          jobId = extracted;
          return false; // break cheerio loop
        }
      });
    }

    if (!jobId || jobId === "정보 없음") {
      // B. componentkey 속성에 포함된 ID 추출 시도 (예: JobDetails_AboutTheJob_4421894718)
      $("[componentkey]").each((_, el) => {
        const key = $(el).attr("componentkey") || "";
        const match = key.match(/(\d+)$/);
        if (match) {
          jobId = match[1];
          return false; // break cheerio loop
        }
      });
    }

    if (!jobId) {
      jobId = "정보 없음";
    }

    // 🛡️ 고진감래 극강 강건성: HTML 타이틀 정보 사전 분석 및 폴백 데이터 수립
    const pageTitle = $("title").first().text().trim();
    let fallbackJobTitle = "";
    let fallbackCompany = "";
    if (pageTitle) {
      const parts = pageTitle.split("|").map((p) => p.trim());
      if (parts.length >= 2) {
        fallbackJobTitle = parts[0];
        fallbackCompany = parts[1];
      } else {
        const atMatch = pageTitle.match(/^(.*)\s+at\s+(.*?)(?:\s*\||$)/i);
        if (atMatch) {
          fallbackJobTitle = atMatch[1].trim();
          fallbackCompany = atMatch[2].trim();
        }
      }
    }

    // 회사명 추출
    let company = $(
      '.topcard__flavor a, .job-details-jobs-unified-top-card__company-name, [data-tracking-control-name="public_jobs_topcard-company-name"]',
    )
      .first()
      .text()
      .trim()
      .replace(/\s+/g, " ");
    if (!company) {
      const ogDesc = $('meta[property="og:description"]').attr("content") || "";
      if (ogDesc.includes(" hiring ")) {
        company = ogDesc
          .split(" hiring ")[0]
          .replace(/Posted.*?\.\s*/i, "")
          .trim()
          .replace(/\s+/g, " ");
      } else {
        company = ogDesc
          .replace(/Posted.*?\.\s*/i, "")
          .substring(0, 20)
          .trim()
          .replace(/\s+/g, " ");
      }
    }
    if (!company || company === "정보 없음") {
      company = fallbackCompany || "정보 없음";
    }

    // 공고 제목 추출
    let jobTitle = $(
      ".topcard__title, h1, .job-details-jobs-unified-top-card__job-title",
    )
      .first()
      .text()
      .trim()
      .replace(/\s+/g, " ");
    if (!jobTitle) {
      const ogTitle = $('meta[property="og:title"]').attr("content") || "";
      jobTitle = ogTitle.includes(" hiring ")
        ? ogTitle.split(" hiring ")[1]?.split(" in ")[0]
        : ogTitle;
      if (jobTitle) jobTitle = jobTitle.trim().replace(/\s+/g, " ");
    }
    if (!jobTitle || jobTitle === "정보 없음") {
      jobTitle = fallbackJobTitle || "정보 없음";
    }

    // 근무 위치 추출
    let location = $(
      ".topcard__flavor--metadata, .job-details-jobs-unified-top-card__flavor--bullet, .topcard__flavor:nth-child(2)",
    )
      .first()
      .text()
      .trim();
    location = location.replace(/\s+/g, " ");
    if (!location || location === "정보 없음") {
      // 폴백: 다국어 난독화 클래스를 깨고 본문 내 텍스트에서 매칭
      $("span, p, div").each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, " ");
        if (text && text.length < 100) {
          // Title 이나 Company Name과 겹치는 경우 매칭 차단 (Korean 이 Korea 에 오매칭되는 것 포함 방지)
          if (jobTitle && text.includes(jobTitle)) return;
          if (company && text.includes(company)) return;

          let locationRegex =
            /\bSouth Korea\b|\bSeoul\b|\bKorea\b|서울|대한민국|United Arab Emirates|Dubai|Germany|Berlin|Singapore|United Kingdom|London|Canada|Toronto|Ireland|Dublin|Japan|Tokyo/i;
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
              const countryMapping = JSON.parse(
                fs.readFileSync(configPath, "utf-8"),
              );
              const allAliases: string[] = [];
              for (const [country, aliases] of Object.entries(countryMapping)) {
                allAliases.push(country);
                if (Array.isArray(aliases)) {
                  allAliases.push(...aliases);
                }
              }
              const uniqueAliases = Array.from(
                new Set(allAliases.filter(Boolean)),
              );
              const escaped = uniqueAliases.map((a) =>
                a.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"),
              );
              const regexParts = escaped.map((a) =>
                /^[a-zA-Z0-9\s]+$/.test(a) ? `\\b${a}\\b` : a,
              );
              locationRegex = new RegExp(regexParts.join("|"), "i");
            }
          } catch (err) {
            // 기본 정규식 유지
          }

          if (locationRegex.test(text)) {
            if (
              !text.includes("ago") &&
              !text.includes("전") &&
              !text.includes("applicant") &&
              !text.includes("지원자") &&
              !text.includes("hiring") &&
              !text.includes("채용") &&
              !text.includes("Premium")
            ) {
              location = text;
              return false; // break
            }
          }
        }
      });
    }
    if (!location) location = "정보 없음";

    // 근무 형태 및 고용 형태
    let workplaceType = "정보 없음";
    $(
      ".description__job-criteria-item, .job-details-jobs-unified-top-card__job-insight",
    ).each((_, el) => {
      const text = $(el).text();
      if (
        text.includes("Remote") ||
        text.includes("On-site") ||
        text.includes("Hybrid") ||
        text.includes("원격") ||
        text.includes("현장")
      ) {
        workplaceType = text.replace(/\s+/g, " ").trim();
      }
    });
    if (workplaceType === "정보 없음") {
      $("span, a, p, div").each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, " ");
        if (
          text === "Remote" ||
          text === "On-site" ||
          text === "Hybrid" ||
          text === "원격" ||
          text === "현장" ||
          text === "하이브리드"
        ) {
          workplaceType = text;
          return false; // break
        }
      });
    }

    let jobType = $(".description__job-criteria-item:nth-child(1), .ui-鈍")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (!jobType || jobType === "정보 없음") {
      $("span, a, p, div").each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, " ");
        if (
          text === "Contract" ||
          text === "Full-time" ||
          text === "Part-time" ||
          text === "Internship" ||
          text === "Temporary" ||
          text === "계약직" ||
          text === "정규직" ||
          text === "인턴"
        ) {
          jobType = text;
          return false; // break
        }
      });
    }

    let applyType = "일반 지원 (External Apply)";
    const applyBtn = $(".apply-button, .jobs-apply-button");
    let hasEasyApply = false;
    if (applyBtn.length > 0) {
      if (
        applyBtn
          .text()
          .trim()
          .match(/Easy Apply|간편 지원/i)
      ) {
        hasEasyApply = true;
      }
    }
    if (!hasEasyApply) {
      $("button, span, a").each((_, el) => {
        const text = $(el).text().trim();
        const label = $(el).attr("aria-label") || "";
        if (
          text.match(/Easy Apply|간편 지원/i) ||
          label.match(/Easy Apply|간편 지원/i)
        ) {
          hasEasyApply = true;
          return false; // break
        }
      });
    }
    if (hasEasyApply) {
      applyType = "간편 지원 (Easy Apply)";
    }

    let jobLink = url || $('link[rel="canonical"]').attr("href") || "";
    if (!jobLink && jobId && jobId !== "정보 없음") {
      jobLink = `https://www.linkedin.com/jobs/view/${jobId}`;
    }
    if (!jobLink) {
      jobLink = "링크를 찾을 수 없음";
    }

    // 포스팅 날짜 추출
    let dateClass = $(
      ".posted-time-ago__text, .posted-time-ago, .job-details-jobs-unified-top-card__posted-date, .jobs-unified-top-card__posted-date",
    )
      .first()
      .text()
      .trim()
      .replace(/\s+/g, " ");
    if (!dateClass) {
      $("span, strong, p").each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, " ");
        if (text && text.length < 50) {
          if (
            /(\d+)\s*(day|week|month|year|hour|minute|second|일|주|달|개월|년|시간|분|초)s?\s*(ago|전)/i.test(
              text,
            )
          ) {
            dateClass = text;
            return false; // break
          }
        }
      });
    }

    const metaDesc = $('meta[name="description"]').attr("content") || "";
    const metaMatch = metaDesc.match(/Posted\s+([^.]+)\./i);
    const dateMeta = metaMatch ? metaMatch[1].trim() : "";

    const postedDate = DateUtils.parseRelativeDate(
      dateClass,
      dateMeta,
      baseDateInput,
    );

    const companyId =
      $('meta[name="companyId"]').attr("content") || "정보 없음";
    const industryId =
      $('meta[name="industryIds"]').attr("content") || "정보 없음";
    const titleId = $('meta[name="titleId"]').attr("content") || "정보 없음";

    // 메인 채용 본문 컨테이너 타겟팅 및 리스트 정렬
    let descriptionContainer = $(
      ".description__text, .jobs-description__content, .jobs-box__html-content",
    );

    // 🛡️ 고극강 강건성: 난독화 레이아웃 대응을 위해 "About the job" 등 헤더 구조 역추적 매칭 폴백
    if (
      descriptionContainer.length === 0 ||
      descriptionContainer.text().trim().length < 100
    ) {
      $("h1, h2, h3, h4").each((_, el) => {
        const headerText = $(el).text().trim();
        if (
          /About the job|About the role|Job description|직무 소개|역할 소개/i.test(
            headerText,
          )
        ) {
          // h2의 부모/조상 div들 중 본문 텍스트가 충분히 있는 가장 가까운 div를 역추적
          $(el)
            .parents("div")
            .each((_, divEl) => {
              const divText = $(divEl).text().trim();
              if (divText.length > headerText.length + 50) {
                descriptionContainer = $(divEl);
                return false; // break parents loop
              }
            });
          if (descriptionContainer.length > 0) return false; // break each loop
        }
      });
    }

    let jdText = "정보 없음";

    if (descriptionContainer.length > 0) {
      const markup = descriptionContainer
        .find(".show-more-less-html__markup")
        .first();
      const target =
        markup.length > 0 && markup.text().trim().length > 0
          ? markup
          : descriptionContainer;

      const rawMarkdown = this.elementToMarkdown($, target[0]);
      const formattedText = rawMarkdown
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      // 회사 소개와 JD 분리 로직 (Split Heuristic)
      const companyEscaped = company
        ? company.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
        : "";
      let splitDone = false;

      if (companyEscaped) {
        const aboutCompanyRegex = new RegExp(
          `(?:^|\\n)(?:#+\\s+)?(About\\s+Us|About\\s+${companyEscaped}|회사\\s*소개|${companyEscaped}\\s*소개)(?:\\s|\\n|:|$)`,
          "i",
        );
        const match = formattedText.match(aboutCompanyRegex);
        if (match && typeof match.index === "number") {
          const splitIndex = match.index;
          const remainingText = formattedText.substring(splitIndex);
          const jdStartRegex =
            /(?:^|\n)(?:#+\\s+)?(Job\s+Description|Role\s+Description|Responsibilities|What\s+you'll\s+do|What\s+you\s+will\s+do|What\s+we\s+are\s+looking\s+for|Qualifications|Requirements|담당\s*업무|주요\s*업무|자격\s*요건|우대\s*사항)(?:\s|\n|:|$)/i;
          const jdMatch = remainingText.match(jdStartRegex);
          if (jdMatch && typeof jdMatch.index === "number") {
            const jdSplitIndex = splitIndex + jdMatch.index;
            jdText = formattedText.substring(jdSplitIndex).trim();
            splitDone = true;
          }
        }
      }

      if (!splitDone) {
        const jdStartRegex =
          /(?:^|\n)(?:#+\\s+)?(Responsibilities|What\s+you'll\s+do|What\s+you\s+will\s+do|What\s+we\s+are\s+looking\s+for|Qualifications|Requirements|담당\s*업무|주요\s*업무|자격\s*요건|우대\s*사항)(?:\s|\n|:|$)/i;
        const jdMatch = formattedText.match(jdStartRegex);
        if (jdMatch && typeof jdMatch.index === "number" && jdMatch.index > 0) {
          const splitIndex = jdMatch.index;
          const prospectiveCompanyText = formattedText
            .substring(0, splitIndex)
            .trim();
          if (prospectiveCompanyText.length >= 20) {
            jdText = formattedText.substring(splitIndex).trim();
            splitDone = true;
          }
        }
      }

      if (!splitDone) {
        jdText = formattedText;
        const metaDesc =
          $('meta[property="og:description"]').attr("content") ||
          $('meta[name="description"]').attr("content") ||
          "";
        if (metaDesc) {
          const cleanMeta = metaDesc
            .replace(/^Posted\s+[^.]+\.\s*/i, "")
            .replace(/^Posted\s+[^.일년주월시분초]+\.\s*/i, "")
            .split(/See\s+this\s+and\s+similar/i)[0]
            .trim();

          if (
            cleanMeta &&
            cleanMeta.length >= 15 &&
            !cleanMeta.startsWith("Apply for") &&
            !cleanMeta.startsWith("지원")
          ) {
            splitDone = true;
          }
        }
        // No split metadata to save
        splitDone = true;
      }
    }

    // country.json 기준 표준 국가명 및 geo 분류 설정
    let country = "Others";
    let geo = "Others";
    const stdLoc = UrlUtils.standardizeLocation(location);

    try {
      const countryMappingPath = path.join(
        __dirname,
        "..",
        "..",
        "config",
        "country.json",
      );
      if (fs.existsSync(countryMappingPath)) {
        const mapping = JSON.parse(
          fs.readFileSync(countryMappingPath, "utf-8"),
        );
        for (const standardCountryName of Object.keys(mapping)) {
          if (stdLoc.toLowerCase() === standardCountryName.toLowerCase()) {
            country = standardCountryName;
            geo = standardCountryName;
            break;
          }
        }
        if (country === "Others") {
          if (stdLoc === "Korea") {
            country = "South Korea";
            geo = "South Korea";
          }
        }
      }
    } catch (e) {}

    if (country === "Others") {
      country = location !== "정보 없음" ? location : "Others";
      geo = "Others";
    }

    const markdownOutput = `---
job_id: "${jobId}"
company_id: "${companyId}"
industry_id: "${industryId}"
title_id: "${titleId}"
job_title: "${jobTitle || "정보 없음"}"
company_name: "${company || "정보 없음"}"
location: "${location || "정보 없음"}"
country: "${country}"
geo: "${geo}"
posted_date: "${postedDate}"
---

# 📌 채용 공고 핵심 요약 (Job Summary)

## 🏢 기본 및 근무 정보 (Basic Info)
* **공고 제목 (Job Title):** ${jobTitle || "정보 없음"}
* **회사명 (Company):** ${company || "정보 없음"}
* **근무 위치 (Location):** ${location || "정보 없음"}
* **국가 (Country):** ${country}
* **지리 구분 (Geo):** ${geo}
* **근무 형태 (Workplace Type):** ${workplaceType}
* **고용 형태 (Job Type):** ${jobType || "정보 없음"}
* **지원 방식 (Apply Type):** ${applyType}
* **포스팅 날짜 (Posted Date):** ${postedDate}
* **공고 링크 (Job Link):** [바로가기 (Link)](${jobLink})

---

## 📝 JD (직무 기술서 / Job Description)
${jdText}
`;

    return {
      jobId,
      company,
      jobTitle,
      rawLocation: location,
      locationDirName: UrlUtils.standardizeLocation(location),
      postedDate,
      rawContent: markdownOutput,
    };
  }

  public async prettify(rawText: string): Promise<string> {
    const prettier = require("prettier");
    let cleaned = rawText.replace(/Show\s+more\s*\n*\s*Show\s+less/gi, "");
    cleaned = cleaned.replace(/(\r?\n\s*){3,}/g, "\n\n");

    const formatted = await prettier.format(cleaned, {
      parser: "markdown",
      proseWrap: "preserve",
      tabWidth: 2,
      printWidth: 100,
    });

    return formatted.replace(/(\r?\n\s*){3,}/g, "\n\n").trim() + "\n";
  }

  /**
   * 🔄 HTML 디렉토리 내의 유실/손상 파일을 MD 문서와 오프라인으로 자동 동기화(Double-Sync)
   */
  public async syncOffline(
    htmlBaseDir: string,
    mdBaseDir: string,
  ): Promise<void> {
    if (!fs.existsSync(htmlBaseDir)) {
      console.log(`💡 HTML 폴더가 없습니다: ${htmlBaseDir}`);
      return;
    }

    console.log(
      "🔄 [Double-Sync] HTML 캐시와 MD 문서 간 오프라인 자동 동기화 분석 기동...",
    );

    function getFiles(dir: string, extension: string): string[] {
      let results: string[] = [];
      if (!fs.existsSync(dir)) return results;
      const list = fs.readdirSync(dir);
      list.forEach((file) => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getFiles(fullPath, extension));
        } else if (file.endsWith(extension)) {
          results.push(fullPath);
        }
      });
      return results;
    }

    const htmlFiles = getFiles(htmlBaseDir, ".html");
    const mdFiles = getFiles(mdBaseDir, ".md");

    const mdJobIds = new Set<string>();
    mdFiles.forEach((file) => {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const match =
          content.match(/job_id:\s*"(\d+)"/) ||
          content.match(/job_id:\s*(\d+)/);
        if (match) {
          mdJobIds.add(match[1]);
        }
      } catch (e: any) {
        console.error(`⚠️  MD 파일 분석 오류 [${file}]: ${e.message}`);
      }
    });

    console.log(
      `📊 탐색 완료: HTML 백업본 ${htmlFiles.length}개 | 마크다운 포스트 ${mdJobIds.size}개`,
    );

    let syncCount = 0;

    for (const htmlPath of htmlFiles) {
      const jobId = path.basename(htmlPath, ".html");
      if (!/^\d+$/.test(jobId)) continue;

      if (!mdJobIds.has(jobId)) {
        syncCount++;
        console.log(
          `🤖 [${syncCount}] 유실본 감지 (ID: ${jobId}) ➡️ 복원 복구 기동 중...`,
        );
        try {
          const htmlContent = fs.readFileSync(htmlPath, "utf-8");
          const fileStats = fs.statSync(htmlPath);
          const meta = await this.convertHtmlToMarkdown(
            htmlContent,
            jobId,
            `https://www.linkedin.com/jobs/view/${jobId}`,
            fileStats.mtime,
          );

          const correctMdDir = path.join(
            mdBaseDir,
            meta.locationDirName,
            meta.postedDate,
          );
          const safeMdFileName = NamingUtils.generateSafeFileName(
            meta.jobTitle,
            meta.company,
          );
          const targetMdPath = path.join(correctMdDir, `${safeMdFileName}.md`);

          await this.prettifyAndSave(meta.rawContent, targetMdPath);
          console.log(`✨ 복원 완료! [ID: ${jobId}] ➡️ ${targetMdPath}`);
        } catch (err: any) {
          console.error(`❌ ID ${jobId} 복구 복원 실패: ${err.message}`);
        }
      }
    }

    if (syncCount === 0) {
      console.log(
        "🎉 [동기화 완료] 유실되거나 복원이 필요한 오프라인 마크다운 문서가 없습니다. 완벽히 매칭됩니다!",
      );
    } else {
      console.log(
        `🎉 [완료] 총 ${syncCount} 개의 유실된 마크다운 문서를 성공적으로 자동 복원했습니다.`,
      );
    }
  }

  /**
   * 🚀 직접 실행 컨트롤러 엔트리 메서드
   */
  public async run(): Promise<void> {
    const inputHtml = process.argv[2];
    const outputMd = process.argv[3];

    if (
      inputHtml &&
      outputMd &&
      inputHtml.endsWith(".html") &&
      outputMd.endsWith(".md")
    ) {
      console.log(
        `🤖 [단일 변환] ${inputHtml} ➡️ ${outputMd} 마크다운 변환 기동...`,
      );
      try {
        if (!fs.existsSync(inputHtml)) {
          throw new Error(`원본 HTML 파일이 존재하지 않습니다: ${inputHtml}`);
        }
        const htmlContent = fs.readFileSync(inputHtml, "utf-8");
        const fileStats = fs.statSync(inputHtml);
        const jobId = path.basename(inputHtml, ".html");
        const meta = await this.convertHtmlToMarkdown(
          htmlContent,
          jobId,
          `https://www.linkedin.com/jobs/view/${jobId}`,
          fileStats.mtime,
        );

        await this.prettifyAndSave(meta.rawContent, outputMd);
        console.log(`✨ 변환 및 프리티어 저장 완료: ${outputMd}`);
        process.exit(0);
      } catch (error: any) {
        console.error(`❌ 단일 변환 에러 발생: ${error.message}`);
        process.exit(1);
      }
    }

    const baseDir = path.join(__dirname, "..", "..", "data", "jobs");
    const htmlBase = path.join(baseDir, "html");
    const mdBase = path.join(baseDir, "markdown");

    await this.syncOffline(htmlBase, mdBase);
    process.exit(0);
  }
}

// 🏭 변환기를 동적으로 생성하는 팩토리 클래스 (Factory Method Pattern 적용)
export class MarkdownConverterFactory {
  public static createConverter(platform: string): IConverter<JobMeta> {
    const lowerPlatform = platform.toLowerCase().trim();
    if (lowerPlatform === "linkedin") {
      return new LinkedInMarkdownConverter();
    }

    throw new Error(
      `[MarkdownConverterFactory] 지원하지 않는 가공 플랫폼입니다: ${platform}`,
    );
  }
}

if (require.main === module) {
  const defaultPlatform = process.argv[4] || "linkedin";
  try {
    const converter = MarkdownConverterFactory.createConverter(
      defaultPlatform,
    ) as LinkedInMarkdownConverter;
    converter.run();
  } catch (err: any) {
    console.error(`❌ 가공엔진 구동 실패: ${err.message}`);
    process.exit(1);
  }
}
