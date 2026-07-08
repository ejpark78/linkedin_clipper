# Changelog - Crawler Service (`projects/crawler`)

All notable changes to the crawler service will be documented in this file.

---

## [1.12.0] - 2026-06-25

### Fixed (Bugfixes)
- **Bugfix: LinkedIn crawler Playwright crash inside Docker**:
  - Docker 컨테이너 등 제한된 권한 환경에서 Chromium 브라우저가 실행될 때 seccomp/샌드박스 보안 정책 충돌로 인해 발생하는 SIGTRAP(강제 종료) 문제를 해결하기 위해, `Crawler.ts` 내 Playwright `chromium.launch` 옵션에 `--no-sandbox` 및 `--disable-setuid-sandbox` 인자를 주입.

## [1.11.0] - 2026-06-23

### Added
- **INDEX.md 자동화 기능**: `squash-artifacts.sh` 스크립트 내부에 `update_index_md` 함수를 구현하여, 아카이빙 시 실물 잔여 아티팩트와 아카이브 파일의 개수를 동적으로 스캔 및 카운팅하여 `docs/artifacts/INDEX.md` 파일을 실시간 자동 재생성 갱신하도록 기능 추가.

## [1.10.0] - 2026-06-23

### Changed
- **아티팩트 아카이빙 개편**:
  - `make agents-squash` (매개변수 없음) 호출 시 triplet squash 완료 후 자동으로 10개 단위 아카이빙(decade group)까지 연속 실행하도록 `squash-artifacts.sh`를 개선.
  - 아카이빙 결과 파일 확장자 명칭을 `*.batch.md`에서 `*.archive.md`로 전면 교환.

## [1.9.0] - 2026-06-23

### Added
- **Docker Autoheal 와치독 서비스**: `willfarrell/autoheal`을 인프라 서비스로 도입하여 `unhealthy` 상태의 컨테이너를 자동 재시작.
- **하트비트 헬스체크 메커니즘**:
  - `ScraperWorker.ts` 및 `ConverterWorker.ts` 내부 루프에서 5초 주기(blpop 대기 시)로 하트비트 파일(`scraper-heartbeat`, `converter-heartbeat`)을 갱신하도록 구현.
  - `projects/crawler/docker/worker/compose.yml` 내 헬스체크를 pgrep 대신 하트비트 파일의 최근 수정 시간(3분 이내) 검사로 변경하여 실질적인 락(Lock) 감지가 가능하도록 조치.

## [1.8.0] - 2026-06-23

### Fixed (Bugfixes)
- **Bugfix: Scraper Worker Deadlock**:
  - Redis 커넥션을 이원화하여 blocking 명령어(`blpop`)용 커넥션과 일반 명령어(`get`, `set`, `rpush`, `lpush` 등)용 커넥션 간의 소켓 경합 및 데드락 제거.
  - `ScraperWorker.ts` 내 `this.dispatcher.scrape` 호출 시 120초 글로벌 실행 타임아웃(`withTimeout`) 래퍼를 도입하여, Playwright 브라우저 대기 및 네트워크 지연 시 영구 블로킹(hanging) 상태에 빠지지 않도록 버그 수정.

## [1.7.0] - 2026-06-23

### Changed
- **AGENTS.md 격리 적용**: 루트 규칙에서 크롤러 전용 제약조건(Playwright 버전 대응, 재귀 수집 제약, 수집 관련 Skill Map 등)을 분리하여 `projects/crawler/AGENTS.md`에 단독 이식 완료.

## [1.3.0] - 2026-06-20

### Added
- **Local Markdown File Scanner**: `data/ebook/output/` 디렉터리에 추출된 도서별 챕터 마크다운 파일들을 분석하여 자동으로 도서 데이터로 조립하는 로더 모듈 구현.

## [1.2.0] - 2026-06-20

### Changed
- **Crawler Scripts Migration (NPM Scripts)**: `scripts/sites/` 하위의 사이트별 Makefile 9개와 `worker.mk`, `gmail.mk`, `tests.mk` 등을 모두 제거하고, 27개의 크롤링 커맨드 및 Gmail/Queue 관련 스크립트, 테스트 관련 스크립트를 `projects/crawler/package.json`의 npm 스크립트로 통합 완료.
- **Makefile Restructuring**: 루트 `Makefile`의 스파게티성 `run-scrape` 로직 및 `PAGE`, `LIST_SLACK` 기본값 정의, 그리고 테스트/디버깅 타겟들을 `projects/crawler/Makefile` 내부로 완벽히 이전 및 이격.

## [1.1.0] - 2026-06-19

### Added
- **Ebook Sync Pipeline**: TypeScript CLI 동기화 스크립트(`sync-ebooks.ts`)를 작성하여 MongoDB(`silver.contents`) 및 Meilisearch(`contents`) 데이터 탑재 자동화.

### Fixed (Bugfixes)
- **Bugfix: TypeScript Compilation and Module Resolution Errors**: `ScraperWorker.ts`, `ConverterWorker.ts`, `IndexerWorker.ts`, `TargetLoader.ts` 내 모듈 참조 경로 버그를 물리 경로(`../../../../packages/database/...`)로 수정.
- **Bugfix: Scripts Entrypoints in Makefiles**: 레거시 메이크파일 내 스크립트 진입점 경로를 `projects/crawler/src/scripts`로 갱신 정렬.

## [1.0.0] - 2026-06-19

### Added
- **Retroactive Noise Cleansing Script**: 수집된 MongoDB 데이터 중 오류가 포함된 legacy ID를 제거하고 재수집을 등록하는 `clean_legacy_noise_ids.ts` 추가.

### Changed
- **Redis Namespace Refactoring**: Sc scraper queues(`sites:${siteKey}:scrape:${priority}`) 및 완료 캐시(`sites:${siteKey}:completed`)와 같은 사이트 중심 네임스페이스 구조 도입.
- **Legacy Fallback Handling**: `BaseListService` 및 `BaseRefreshUrls` 내 legacy 캐시 접두사 매핑 및 업데이트 지원.

### Fixed
- **Cross-Site Cache Collision Bug**: 사이트 간 동일 Redis 완료 캐시 키 사용으로 인해 스케줄링 큐 유입 과정에서 캐시 스킵 현상이 발생하던 구조적 충돌 버그 해결.
