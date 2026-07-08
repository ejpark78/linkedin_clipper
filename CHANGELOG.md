# Monorepo Changelog (Index)

이 마스터 Changelog 파일은 모노레포 프로젝트의 통합 마일스톤 이력 및 서비스별 상세 변경 이력 연결을 담당합니다.

---

## 🧭 서비스별 상세 변경 이력 (Sub-module Changelogs)

상세 컴포넌트별 릴리즈 및 변경 로그는 각 서비스 폴더 내부의 개별 Changelog를 참고하세요.
* 🕷️ **Crawler 서비스**: [projects/crawler/CHANGELOG.md](file:///home/ejpark/workspace/scraper/projects/crawler/CHANGELOG.md)

* 🖥️ **Viewer & Dashboard**: [projects/viewer/CHANGELOG.md](file:///home/ejpark/workspace/scraper/projects/viewer/CHANGELOG.md)

* 📚 **Ebook 파이프라인**: [projects/ebook/CHANGELOG.md](file:///home/ejpark/workspace/scraper/projects/ebook/CHANGELOG.md)
---

## 🎯 통합 버전 이력 요약 (Global Milestones)

### [1.14.0] - 2026-06-25
* **LinkedIn 크롤러 Playwright Crash 해결 (Bugfix)**: Docker 컨테이너 등 제한된 권한 환경에서 Chromium 브라우저 기동 시 seccomp/샌드박스 정책 충돌로 인해 수집기가 `unhealthy` 상태에 빠지고 큐가 줄어들지 않던 SIGTRAP 오류 현상을 해결하기 위해, `Crawler.ts` 내 Chromium 브라우저 론치 옵션에 `--no-sandbox` 및 `--disable-setuid-sandbox` 인자를 강제 주입.

### [1.13.0] - 2026-06-23
* **Joplin CLI 통합 및 ID/PW 동기화 도입**: 백엔드 Docker 컨테이너 내에 Headless Joplin CLI를 연동하여 자체 동기화 서버와 ID/PW 및 E2EE 복호화 키로 직접 데이터를 동기화하고, 노트북 단위 마크다운 및 이미지 리소스 임포트(export)를 일괄 처리하는 파이프라인 구현.

### [1.12.0] - 2026-06-23

* **Git Flow 브랜치 모델 도입**: `AGENTS.md`에 Git Flow 브랜치 규격 및 에이전트 행동 지침을 명문화하고, 100줄 제한을 완화하여 중복/예제 위주로만 정리하도록 갱신. 자동 커밋 스크립트(`commit-changes.sh`)가 현재 체크아웃된 브랜치명(`feature/###-*`, `hotfix/###-*`)을 감지하여 커밋 메시지를 적절한 접두사로 빌드하도록 고도화.

### [1.11.0] - 2026-06-23
* **INDEX.md 자동화**: 아티팩트 squash 및 아카이빙 시 실물 상태에 의거해 `INDEX.md`의 아카이브/개별 링크 및 병합 개수를 동적 스캔하여 실시간 자동 갱신하도록 스크립트 기능 추가.

### [1.10.0] - 2026-06-23
* **아티팩트 아카이빙 통합 및 명칭 교체**: `make agents-squash`를 통해 triplet squash와 10개 단위 아카이빙이 순차 연계 실행되도록 개선하고 아카이브 파일의 명칭을 `*.batch.md`에서 `*.archive.md`로 변경.

### [1.9.0] - 2026-06-23
* **컨테이너 와치독 및 하트비트 도입**: autoheal 서비스 통합, 워커 루프 하트비트 파일 터치 및 3분 경과 검출 기반의 정밀 헬스체크 구현으로 데드락/오동작 무중단 복구 제공.

### [1.8.0] - 2026-06-23
* **Scraper 데드락 해결 (Bugfix)**: Redis blpop용 전용 커넥션 도입(이원화) 및 120초 글로벌 타임아웃 래퍼 적용을 통해 크롤러 워커 블로킹 현상 완벽 방지.

### [1.7.0] - 2026-06-23
* **격리 아키텍처 수립**: `AGENTS.md` 규칙 및 `CHANGELOG.md` 변경 로그를 각 모노레포 패키지(`projects/crawler`, `projects/viewer`, `projects/ebook`) 하위로 정밀하게 격리 및 분리 분할하여 결합도 최소화.
* **계획 승인 후 일괄 실행 규칙 완화**: 계획서(.plan.md) 승인 획득 이후에는 추가적인 파일 생성 및 소스 코드 수정 관련 개별 차단 승인 없이 한 번에 자율적으로 단일 턴에 처리할 수 있도록 AGENTS.md 2번 제약 사항 개정.

### [1.6.0] - 2026-06-22
* **Ebook 서비스 정밀 단순화**: Ebook 모듈의 Command 패턴 복잡성을 제거하고 단일 진입점 OOP 구현으로 정비.

### [1.5.0] - 2026-06-21
* **Ebook 테스트 도입**: Ebook 서비스 파이프라인 전면 리팩토링 및 30여 개의 단위 테스트 작성.

### [1.4.0] - 2026-06-20
* **Exporter 웹 통합**: Joplin/Obsidian Exporter 대시보드 웹 통합 배포 및 Vue Router 전환.

### [1.3.0] - 2026-06-20
* **Exporter 모듈 신설**: Exporter 기능 마이그레이션 및 동적 마크다운 로더 구현.

### [1.2.0] - 2026-06-20
* **모노레포 빌드 아키텍처 개편**: 기존 쉘/메이크파일 스크립트 결합도를 해소하고, `package.json`의 npm 스크립트로 크롤러 커맨드를 일괄 이관 및 모노레포 구조 세분화.

### [1.1.0] - 2026-06-19
* **Ebook 파이프라인 추가**: PDF 정제 및 Meilisearch/MongoDB 가공 유틸리티 통합 탑재.

### [1.0.0] - 2026-06-19
* **Redis 네임스페이스 격리**: Redis 큐 충돌 및 오동작을 수정한 Namespace 개편 릴리즈.
