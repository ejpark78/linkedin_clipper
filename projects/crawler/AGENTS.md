# 🤖 Agent Project Rules - Crawler Scope (projects/crawler/AGENTS.md)

이 규칙은 `projects/crawler` 내의 코드를 수정하거나 해당 컨텍스트에서 작업을 수행할 때 적용되는 전용 제약 사항입니다.

---

## ⚠️ crawler 전용 제약 사항 (Critical Constraints)

1. **Docker 중심 테스트 및 실행**:
   - **디버깅/테스트**: 항상 볼륨 마운트를 사용하여 소스 파일을 실시간 동기화합니다.
     - 예시: `docker compose -p scraper run --rm --user $(id -u):$(id -g) -v $(pwd):/app -v /app/node_modules worker npx ts-node src/...`
   - **Playwright 브라우저 불일치**: `browserType.launch: Executable doesn't exist` 오류 발생 시 다음 중 하나를 실행합니다:
     - 종속성 버전 정렬을 위해 worker 이미지만 재빌드: `docker compose build worker`
     - 또는 컨테이너에서 브라우저 설치: `docker compose run --rm worker npx playwright install`
   - **컨테이너 와치독 및 하트비트**: 백그라운드 워커 컨테이너(scraper, converter)는 락(Lock) 상태 감지를 위해 실행 루프 내에서 하트비트 파일(예: `/tmp/scraper-heartbeat`, `/tmp/converter-heartbeat`)을 주기적으로 갱신해야 합니다. Docker `healthcheck`는 이 파일의 최근 수정 시간(3분 이내)을 대조하여 비정상 대기 감지 시 `unhealthy`로 판단하며, `autoheal` 와치독 컨테이너가 헬스 실패 시 자동으로 컨테이너를 재시작(`autoheal=true` 라벨 활용)합니다.

2. **재귀 수집 금지 및 1회성 수집 고정**:
   - 실시간 스크랩 시 페이지 내 링크들을 파싱하여 수집 큐에 재유입시키는 재귀 수집(`RECURSIVE_SCRAPE`) 기능은 제거되었습니다.
   - 모든 수집 작업은 1회성 수집으로 고정되며, 큐에는 1회성 명령만 추가되어 무한 큐 증식을 방지합니다. (단, `BaseRefreshUrls.ts`에 내장된 기존 완료 HTML 정밀 스캔 복구 기능은 그대로 보존되어 정상 작동합니다.)

---

## 🧭 Agent Skill Directory Map (Crawler Context)

작업 시 crawler 컨텍스트에 따라 해당 Skill 파일을 활성화/참조하세요:

| 컨텍스트 | Skill 파일 | 설명 |
|:---|:---|:---|
| 사이트 크롤러/파이프라인 | [develop_sites_skills.md](../../.agents/skills/develop_sites_skills.md) | Bronze→Silver 파이프라인, Base 클래스 |
| HTML/스크래핑 디버깅 | [html_debugging_skills.md](../../.agents/skills/html_debugging_skills.md) | HtmlDebugger 유틸, HTML 덤프 |

3. **테스트 및 격리 모듈 실행 규정**:
   - 단위 테스트 실행 시 패키지별 로컬 의존성 격리 문제를 방지하기 위해, `ts-node` 실행 스크립트 작성 시 명시적으로 프로젝트 파일 지정 옵션(`-P tsconfig.json`)을 의무 명시합니다.
   - 로컬 의존성이 얽혀 모듈을 로드하지 못하는 현상을 방지하기 위해, 환경 빌드 및 단위 테스트 기동 전에 반드시 로컬 패키지 영역(`projects/crawler`)에서 명시적인 `npm install`을 실행하여 의존성을 정합해 두어야 합니다.

