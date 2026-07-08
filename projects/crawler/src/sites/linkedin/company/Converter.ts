/**
 * @module Converter
 * @description Core functionality or script runner for Converter.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path, cheerio, prettier, IConverter
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { BaseConverter } from "../../../core/BaseConverter";

import { CompanyMeta } from "./site.config";

export class CompanyMarkdownConverter extends BaseConverter<CompanyMeta> {
  /**
   * HTML 내용을 파싱하여 회사 메타정보와 마크다운 문서를 빌드합니다. (하이브리드 구조: JSON 우선 ➡️ DOM 폴백)
   */
  public async convertHtmlToMarkdown(
    htmlContent: string,
    companyId: string,
    companyUrl: string,
  ): Promise<CompanyMeta> {
    let companyName = "";
    let tagline = "";
    let website = "";
    let industry = "";
    let companySize = "";
    let employeeCount = "";
    let hqCountry = "";
    let hqGeographicArea = "";
    let hqCity = "";
    let hqPostalCode = "";
    let hqLine1 = "";
    let hqLine2 = "";
    let hqDescription = "";
    let founded = "";
    let specialties = "";
    let phone = "";
    let parentCompany = "";
    let overviewText = "";
    let hqLocation = ""; // 통합 주소 텍스트

    const $ = cheerio.load(htmlContent);

    // HTML 타이틀에서 원래 타겟 회사명 추출 (예: "CJ OLIVE YOUNG: About | LinkedIn" -> "CJ OLIVE YOUNG")
    const titleText = $("title").text() || "";
    const mainTitleName = titleText
      .replace(": About | LinkedIn", "")
      .replace("| LinkedIn", "")
      .trim();

    // 🛡️ [1단계] JSON 기반 데이터 추출 시도 (Voyager State 복원)
    const codeRegex = /<code[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/code>/g;
    let match;

    let targetCompanyObj: any = null;

    while ((match = codeRegex.exec(htmlContent)) !== null) {
      let content = match[2].trim();
      if (content.startsWith("<!--") && content.endsWith("-->")) {
        content = content.substring(4, content.length - 3).trim();
      }
      if (!content) continue;

      const sanitized = content
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");

      try {
        const obj = JSON.parse(sanitized);
        if (obj.included && Array.isArray(obj.included)) {
          // 모든 Company 객체 필터링
          const companies = obj.included.filter((item: any) =>
            item.$type?.includes("organization.Company"),
          );

          if (companies.length > 0) {
            // 1순위: universalName이 companyId와 대소문자 무시하고 완전히 일치
            let matched = companies.find(
              (c: any) =>
                c.universalName?.toLowerCase() === companyId.toLowerCase(),
            );

            // 2순위: name이 HTML 타이틀에서 얻은 이름과 일치
            if (!matched && mainTitleName) {
              matched = companies.find(
                (c: any) =>
                  c.name?.trim().replace(/\s+/g, " ").toLowerCase() ===
                  mainTitleName.toLowerCase(),
              );
            }

            // 3순위: universalName이 HTML 타이틀의 공백제거 소문자와 일치
            if (!matched && mainTitleName) {
              const titleId = mainTitleName
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");
              matched = companies.find((c: any) => {
                const uid =
                  c.universalName?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
                  "";
                return uid && uid === titleId;
              });
            }

            // 4순위: 그냥 첫 번째 회사 객체
            if (!matched) {
              matched = companies[0];
            }

            if (matched) {
              targetCompanyObj = matched;

              // Industry 매핑을 위해 context obj 저장
              const industryUrns =
                targetCompanyObj["*industryV2Taxonomy"] ||
                targetCompanyObj["*industry"] ||
                [];
              if (industryUrns.length > 0) {
                const matchedIndustries: string[] = [];
                obj.included.forEach((item: any) => {
                  if (
                    (item.$type?.includes("Industry") ||
                      item.$type?.includes("IndustryV2")) &&
                    industryUrns.includes(item.entityUrn)
                  ) {
                    const indName = item.name || item.localizedName;
                    if (indName) matchedIndustries.push(indName.trim());
                  }
                });
                if (matchedIndustries.length > 0) {
                  industry = matchedIndustries.join(", ");
                }
              }
              break;
            }
          }
        }
      } catch (e) {
        // 파싱 에러 패스
      }
    }

    if (targetCompanyObj) {
      const company = targetCompanyObj;
      if (company.name) {
        companyName = company.name.trim().replace(/\s+/g, " ");
      }
      if (company.tagline) {
        tagline = company.tagline.trim().replace(/\s+/g, " ");
      }
      if (company.websiteUrl || company.companyPageUrl || company.url) {
        website = company.websiteUrl || company.companyPageUrl || company.url;
      }
      if (company.description) {
        overviewText = company.description.trim().replace(/\n {2,}/g, "\n");
      }
      if (company.employeeCount) {
        employeeCount = String(company.employeeCount);
      }
      if (company.employeeCountRange) {
        const start = company.employeeCountRange.start;
        const end = company.employeeCountRange.end;
        companySize =
          start && end
            ? `${start}-${end} employees`
            : start
              ? `${start}+ employees`
              : "";
      }
      if (company.foundedOn) {
        founded = String(
          company.foundedOn.year ||
            company.foundedOn.foundedOn ||
            company.foundedOn ||
            "",
        );
      }

      const rawSpecialties = company.specialities || company.specialties || [];
      if (Array.isArray(rawSpecialties)) {
        specialties = rawSpecialties
          .map((s: string) => s.trim().replace(/\s+/g, " "))
          .join(", ");
      }

      if (company.phone) {
        phone = String(company.phone).trim();
      }

      if (company.parentCompany || company["*parentCompany"]) {
        parentCompany = company.parentCompany || company["*parentCompany"];
      }

      if (company.headquarter) {
        const addr = company.headquarter.address;
        if (addr) {
          hqCountry = addr.country ? addr.country.trim() : "";
          hqGeographicArea = addr.geographicArea
            ? addr.geographicArea.trim().replace(/\s+/g, " ")
            : "";
          hqCity = addr.city ? addr.city.trim().replace(/\s+/g, " ") : "";
          hqPostalCode = addr.postalCode ? addr.postalCode.trim() : "";
          hqLine1 = addr.line1 ? addr.line1.trim().replace(/\s+/g, " ") : "";
          hqLine2 = addr.line2 ? addr.line2.trim().replace(/\s+/g, " ") : "";

          const parts: string[] = [];
          if (hqLine1) parts.push(hqLine1);
          if (hqLine2) parts.push(hqLine2);
          if (hqCity) parts.push(hqCity);
          if (hqGeographicArea) parts.push(hqGeographicArea);
          if (hqCountry) parts.push(hqCountry);
          hqLocation = parts.join(", ");
        }
        if (company.headquarter.description) {
          hqDescription = company.headquarter.description
            .trim()
            .replace(/\s+/g, " ");
        }
      }
    }

    // 🛡️ [2단계] DOM 기반 Fallback 추출 (JSON 추출이 실패했거나 누락된 항목이 있을 때 가동)
    if (!companyName) {
      companyName = $(".org-top-card-summary__title, h1").first().text().trim();
      if (!companyName) {
        companyName = $("title")
          .text()
          .replace(": About | LinkedIn", "")
          .replace("| LinkedIn", "")
          .trim();
      }
      if (!companyName) {
        companyName = companyId;
      }
    }

    if (!tagline) {
      tagline = $(".org-top-card-summary__tagline")
        .first()
        .text()
        .trim()
        .replace(/\s+/g, " ");
    }

    // 개별 속성에 대한 DOM Fallback 매핑
    let domWebsite = "";
    let domIndustry = "";
    let domCompanySize = "";
    let domHq = "";
    let domFounded = "";
    let domSpecialties = "";

    $("dl").each((_, dl) => {
      $(dl)
        .find("dt")
        .each((__, dt) => {
          const term = $(dt).text().trim().toLowerCase().replace(/:$/, "");
          const dd = $(dt).next("dd");
          const value = dd.text().trim().replace(/\s+/g, " ");

          if (term.includes("website")) {
            domWebsite = value;
          } else if (term.includes("industry")) {
            domIndustry = value;
          } else if (term.includes("company size")) {
            domCompanySize = value;
          } else if (term.includes("headquarters")) {
            domHq = value;
          } else if (term.includes("founded")) {
            domFounded = value;
          } else if (term.includes("specialties")) {
            domSpecialties = value;
          }
        });
    });

    website = website || domWebsite || "정보 없음";
    industry = industry || domIndustry || "정보 없음";
    companySize = companySize || domCompanySize || "정보 없음";
    founded = founded || domFounded || "정보 없음";
    specialties = specialties || domSpecialties || "정보 없음";

    if (!hqLocation) {
      hqLocation = domHq || "정보 없음";
    }

    // Overview DOM Fallback
    if (!overviewText || overviewText === "정보 없음") {
      const cardSpacing = $(".org-page-details-module__card-spacing");
      if (cardSpacing.length > 0) {
        const paragraphs: string[] = [];
        cardSpacing.find("p").each((_, p) => {
          const txt = $(p).text().trim();
          if (txt && !txt.includes("Verified page")) {
            paragraphs.push(txt);
          }
        });
        if (paragraphs.length > 0) {
          overviewText = paragraphs.join("\n\n");
        }
      }
      if (!overviewText || overviewText === "정보 없음") {
        $("h2").each((_, h2) => {
          const text = $(h2).text().trim();
          if (/Overview|회사\s*개요|소개/i.test(text)) {
            const parent = $(h2).parent();
            const paragraphs: string[] = [];
            parent.find("p").each((__, p) => {
              const txt = $(p).text().trim();
              if (txt) paragraphs.push(txt);
            });
            if (paragraphs.length > 0) {
              overviewText = paragraphs.join("\n\n");
              return false; // break
            }
          }
        });
      }
    }
    if (!overviewText) {
      overviewText = "정보 없음";
    }

    // URL 정규화
    let normalizedCompanyUrl = companyUrl.trim();
    if (!normalizedCompanyUrl.replace(/\/$/, "").endsWith("/about")) {
      normalizedCompanyUrl = normalizedCompanyUrl.replace(/\/$/, "") + "/about";
    }
    try {
      normalizedCompanyUrl = decodeURIComponent(normalizedCompanyUrl);
    } catch (e) {
      // 무시
    }

    // 4. 최종 마크다운 템플릿 생성
    const markdownOutput = `---
company_id: "${companyId}"
company_name: "${companyName}"
tagline: "${tagline || "정보 없음"}"
website: "${website}"
industry: "${industry}"
company_size: "${companySize}"
employee_count: "${employeeCount || "정보 없음"}"
hq_country: "${hqCountry || "정보 없음"}"
hq_geographic_area: "${hqGeographicArea || "정보 없음"}"
hq_city: "${hqCity || "정보 없음"}"
hq_postal_code: "${hqPostalCode || "정보 없음"}"
hq_line1: "${hqLine1 || "정보 없음"}"
hq_line2: "${hqLine2 || "정보 없음"}"
hq_description: "${hqDescription || "정보 없음"}"
founded: "${founded}"
specialties: "${specialties}"
linkedin_: "${normalizedCompanyUrl}"
phone: "${phone || "정보 없음"}"
parent_company: "${parentCompany || "정보 없음"}"
---

# 🏢 회사 소개: ${companyName}
${tagline ? `> **${tagline}**\n` : ""}
## 📝 회사 개요 (Overview)
${overviewText}

---

## ⚙️ 상세 정보 (Details)
* **공식 웹사이트:** [바로가기](${website !== "정보 없음" && website.startsWith("http") ? website : "#"}) (${website})
* **업종 (Industry):** ${industry}
* **회사 규모 (Company Size):** ${companySize}
* **실제 직원 수 (Employee Count):** ${employeeCount || "정보 없음"}
* **설립년도 (Founded):** ${founded}
* **연락처 (Phone):** ${phone || "정보 없음"}
* **모회사 (Parent Company):** ${parentCompany || "정보 없음"}

---

## 📍 본사 위치 정보 (Headquarters)
* **통합 주소:** ${hqLocation}
* **국가 (Country):** ${hqCountry || "정보 없음"}
* **지역 (State/Province):** ${hqGeographicArea || "정보 없음"}
* **도시 (City):** ${hqCity || "정보 없음"}
* **우편번호 (Postal Code):** ${hqPostalCode || "정보 없음"}
* **상세 주소 1 (Line 1):** ${hqLine1 || "정보 없음"}
* **상세 주소 2 (Line 2):** ${hqLine2 || "정보 없음"}
* **본사 설명 (Location Note):** ${hqDescription || "정보 없음"}

---

## 🚀 주요 전문 분야 (Specialties)
${
  specialties
    ? specialties
        .split(", ")
        .map((s) => `* ${s}`)
        .join("\n")
    : "정보 없음"
}
`;

    return {
      companyId,
      companyName,
      tagline,
      website,
      industry,
      companySize,
      employeeCount,
      hqCountry,
      hqGeographicArea,
      hqCity,
      hqPostalCode,
      hqLine1,
      hqLine2,
      hqDescription,
      founded,
      specialties,
      linkedinUrl: normalizedCompanyUrl,
      phone,
      parentCompany,
      rawContent: markdownOutput,
    };
  }
}
