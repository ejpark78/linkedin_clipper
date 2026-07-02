/**
 * @module UrlManager.test
 * @description Core functionality or script runner for UrlManager.test.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies assert, UrlManager
 * @lastUpdated 2026-06-11
 */

import * as assert from "assert";
import {
  descriptor,
  Config,
} from "../../../src/sites/linkedin/jobs/site.config";

console.log("🧪 [시작] url_manager.ts 단위 테스트(Unit Test)를 실행합니다.");

const generateUrls = (config: Config, options?: unknown): string[] => {
  if (!descriptor.scraper?.generateUrls) {
    throw new Error("generateUrls not defined on descriptor");
  }
  return descriptor.scraper.generateUrls(config as any, options as any);
};

try {
  // Test Case 1: Dynamic geo_registry and parameter_registry mapping
  const mockConfig1: Config = {
    geo_registry: {
      Korea: "105149562",
    },
    parameter_registry: {
      f_TPR: {
        "past 24 hours": "r86400",
        "past 1 week": "r604800",
      },
      sortBy: {
        relevant: "R",
        recent: "DD",
      },
    },
    global_settings: {
      distance: "50",
      f_TPR: "past 24 hours",
      sortBy: "relevant",
      spellCorrectionEnabled: true,
    },
    search_targets: [
      {
        location: "Korea",
        keywords: ["AI Engineer", "MLOps"],
      },
    ],
    direct_urls: ["https://www.linkedin.com/jobs/collections/recommended"],
  };

  const result1 = generateUrls(mockConfig1);

  // Assertions for Case 1
  assert.strictEqual(result1.length, 3, "결과 URL 개수는 3개여야 합니다.");

  assert.ok(
    result1[0].includes("keywords=AI+Engineer"),
    "첫 번째 URL에 keywords=AI+Engineer가 포함되어야 합니다.",
  );
  assert.ok(
    result1[0].includes("geoId=105149562"),
    "첫 번째 URL에 geoId가 포함되어야 합니다.",
  );
  assert.ok(
    result1[0].includes("distance=50"),
    "첫 번째 URL에 distance=50이 포함되어야 합니다.",
  );
  assert.ok(
    result1[0].includes("f_TPR=r86400"),
    "첫 번째 URL에 f_TPR=r86400이 포함되어야 합니다 (인체 친화적 별칭 자동 번역 검증).",
  );
  assert.ok(
    result1[0].includes("sortBy=R"),
    "첫 번째 URL에 sortBy=R이 포함되어야 합니다 (인체 친화적 별칭 자동 번역 검증).",
  );
  assert.ok(
    result1[0].includes("spellCorrectionEnabled=true"),
    "첫 번째 URL에 spellCorrectionEnabled=true가 포함되어야 합니다.",
  );

  assert.ok(
    result1[1].includes("keywords=MLOps"),
    "두 번째 URL에 keywords=MLOps가 포함되어야 합니다.",
  );
  assert.strictEqual(
    result1[2],
    "https://www.linkedin.com/jobs/collections/recommended",
    "세 번째 URL은 direct_url이어야 합니다.",
  );

  console.log(
    "✅ 테스트 케이스 1 통과 (geo_registry 및 parameter_registry 통합 조회 매핑 검증 완료)",
  );

  // Test Case 2: Registry lookup failure fallbacks (raw values fallback)
  const mockConfig2: Config = {
    geo_registry: {
      Korea: "105149562",
    },
    parameter_registry: {
      f_TPR: {
        "past 24 hours": "r86400",
      },
    },
    global_settings: {
      f_TPR: "r604800", // Registry에 없으므로 원시값 그대로 통과해야 함
      sortBy: "DD", // Registry에 없으므로 원시값 그대로 통과해야 함
    },
    search_targets: [
      {
        location: "Tokyo, Japan", // Registry에 없으므로 원시 문자열 그대로 통과해야 함
        keywords: ["Backend"],
      },
    ],
  };

  const result2 = generateUrls(mockConfig2);

  assert.strictEqual(result2.length, 1, "결과 URL 개수는 1개여야 합니다.");
  assert.ok(
    result2[0].includes("keywords=Backend"),
    "URL에 keywords가 포함되어야 합니다.",
  );
  assert.ok(
    result2[0].includes("location=Tokyo%2C+Japan"),
    "geoId 대신 location이 URL 인코딩되어 포함되어야 합니다.",
  );
  assert.ok(
    result2[0].includes("f_TPR=r604800"),
    "원시 f_TPR 코드가 그대로 통과되어 포함되어야 합니다.",
  );
  assert.ok(
    result2[0].includes("sortBy=DD"),
    "원시 sortBy 코드가 그대로 통과되어 포함되어야 합니다.",
  );

  console.log(
    "✅ 테스트 케이스 2 통과 (지정된 매핑 사전이 없거나 매칭되지 않는 경우 원시값 Fallback 보존 검증 완료)",
  );

  // Test Case 3: Backward compatibility (direct geoId in search target)
  const mockConfig3: Config = {
    search_targets: [
      {
        location: "Custom Loc",
        geoId: "999999",
        keywords: ["Frontend"],
      },
    ],
  };

  const result3 = generateUrls(mockConfig3);
  assert.strictEqual(result3.length, 1, "결과 URL 개수는 1개여야 합니다.");
  assert.ok(
    result3[0].includes("keywords=Frontend"),
    "URL에 keywords가 포함되어야 합니다.",
  );
  assert.ok(
    result3[0].includes("geoId=999999"),
    "하위 호환성을 위해 target에 직접 지정된 geoId가 적용되어야 합니다.",
  );

  console.log(
    "✅ 테스트 케이스 3 통과 (target에 직접 지정된 geoId 하위 호환성 검증 완료)",
  );

  // Test Case 4: Empty settings
  const mockConfig4: Config = {};
  const result4 = generateUrls(mockConfig4);
  assert.strictEqual(
    result4.length,
    0,
    "빈 설정인 경우 결과는 0개여야 합니다.",
  );

  console.log(
    "✅ 테스트 케이스 4 통과 (예외 상황 및 빈 객체 안전 차단 검증 완료)",
  );

  // Test Case 5: Auto-pagination loop using max_page
  const mockConfig5: Config = {
    global_settings: {
      max_page: 3, // Default: generate 3 pages (start=0, start=25, start=50)
    },
    search_targets: [
      {
        location: "Korea",
        keywords: ["AI"],
        max_page: 2, // Specific override: generate 2 pages (start=0, start=25)
      },
      {
        location: "Japan",
        keywords: ["AI"], // Falls back to global max_page (3 pages)
      },
    ],
  };

  const result5 = generateUrls(mockConfig5);
  assert.strictEqual(
    result5.length,
    5,
    "결과 URL 개수는 5개여야 합니다 (Korea 2개 + Japan 3개).",
  );

  // Korea targets (max_page: 2)
  assert.ok(
    !result5[0].includes("start="),
    "첫 번째 페이지는 start 파라미터가 생략되어야 합니다.",
  );
  assert.ok(
    result5[1].includes("start=25"),
    "두 번째 페이지는 start=25가 포함되어야 합니다.",
  );

  // Japan targets (max_page: 3)
  assert.ok(
    !result5[2].includes("start="),
    "세 번째 페이지는 start 파라미터가 생략되어야 합니다.",
  );
  assert.ok(
    result5[3].includes("start=25"),
    "네 번째 페이지는 start=25가 포함되어야 합니다.",
  );
  assert.ok(
    result5[4].includes("start=50"),
    "다섯 번째 페이지는 start=50이 포함되어야 합니다.",
  );

  console.log(
    "✅ 테스트 케이스 5 통과 (max_page 기반 자동 다중 페이지 네비게이션 생성 및 오버라이딩 검증 완료)",
  );

  // Test Case 6: skipDirectUrls options validation
  const mockConfig6: Config = {
    direct_urls: ["https://www.linkedin.com/jobs/collections/recommended"],
  };

  const result6 = generateUrls(mockConfig6, { skipDirectUrls: true });
  assert.strictEqual(
    result6.length,
    0,
    "skipDirectUrls 옵션이 true일 때는 direct_urls 수집 목록이 비어있어야 합니다.",
  );

  const result6_include = generateUrls(mockConfig6, { skipDirectUrls: false });
  assert.strictEqual(
    result6_include.length,
    1,
    "skipDirectUrls 옵션이 false(기본값)일 때는 direct_urls가 포함되어야 합니다.",
  );

  console.log(
    "✅ 테스트 케이스 6 통과 (skipDirectUrls 옵션 활성화 시 direct_urls 배제 동작 검증 완료)",
  );

  console.log(
    "\n🎉 [성공] 모든 url_manager.ts 단위 테스트가 완벽히 통과되었습니다!",
  );
  process.exit(0);
} catch (error: unknown) {
  console.error(`\n❌ 테스트 실패: ${(error as Error).message}`);
  console.error((error as Error).stack);
  process.exit(1);
}
