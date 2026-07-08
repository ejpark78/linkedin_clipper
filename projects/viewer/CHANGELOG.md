# Changelog - Viewer Service (`projects/viewer`)

All notable changes to the viewer and web dashboard service will be documented in this file.

---

## [1.8.0] - 2026-06-23

### Added
- **Joplin CLI 통합 및 ID/PW 동기화**: 자체 동기화 서버로부터 데이터를 받아오는 CLI 백엔드 처리 로직 및 UI 연동 제공.
- **E2EE 복호화 옵션**: 동기화 셋업 시 E2EE 암호 키를 입력해 직접 로컬 DB에서 마크다운 텍스트를 해독할 수 있게 지원.

## [1.7.0] - 2026-06-23


### Changed
- **AGENTS.md 격리 적용**: 루트 규칙에서 뷰어 전용 제약조건(프론트엔드 이미지 컴파일 지침, 환경 위임 협업 원칙 등)을 분리하여 `projects/viewer/AGENTS.md`에 단독 이식 완료.

## [1.4.5] - 2026-06-20

### Changed
- **Exporter 설정 카드 최소 높이 재조정**: 입력 폼 단순화에 따라 설정 카드의 `min-height`를 기존 `615px`에서 `470px`로 하향 조정하여 화면 하단 여백 스페이스 최적화.

## [1.4.4] - 2026-06-20

### Removed
- **서적 경로 직접 입력 기능 제거**: 내보내기 폼 UX 간소화를 위해 서적 경로를 직접 타이핑해 입력하는 필드와 안내 텍스트를 화면에서 영구 삭제.

## [1.4.3] - 2026-06-20

### Fixed (Bugfixes)
- **Bugfix: 내보내기 문서 내 로컬 이미지 깨짐(엑스박스) 문제 완벽 수정**: Joplin 내보내기 시 상대 경로 이미지를 처리하기 위해 프론트엔드가 이미지 Blob을 획득하여 Joplin 리소스 API(`POST /resources`)로 직접 자동 업로드한 뒤 본문을 리소스 ID 식별자(`:/resource_id`)로 치환하여 연동되도록 수정.

## [1.4.2] - 2026-06-20

### Fixed (Bugfixes)
- **Bugfix: 내보내기 정렬 역순 현상 교정**: 책 챕터들이 최신순 정렬 특성으로 인해 역순으로 정렬되던 정렬 방향 오류를 수정하여, 마지막 장부터 첫 장 순서로 생성하도록 정렬 교정.

## [1.4.1] - 2026-06-20

### Fixed (Bugfixes)
- **Bugfix: 브라우저 직접 내보내기(Direct Export) 지원**: Docker 컨테이너 망 내에서 Joplin/Obsidian 루프백 포트에 접근할 수 없는 방화벽 제한을 해결하기 위해 프론트엔드 브라우저에서 직접 사용자 로컬 포트로 API를 쏘는 아키텍처로 개편.
- **GET /api/exporter/book-content API 추가**: 책 전체 내용을 챕터별로 묶어 반환하는 Exporter 전용 백엔드 API 추가.

## [1.4.0] - 2026-06-20

### Added
- **Joplin/Obsidian Exporter Web Integration**: `apps/exporter` 패키지를 `projects/viewer` 내로 마이그레이션하고 Express 라우터 및 `ExporterView.vue` 화면을 추가하여 대시보드 내에 통합 완료.
- **Frontend Vue Router Migration**: 단일 `App.vue`에 비대하게 뭉쳐있던 컴포넌트들을 `DashboardView.vue`, `DocumentView.vue`, `ExporterView.vue`로 전면 리팩토링 및 분리하고 `vue-router` 라우팅 체계 정립.
- **Joplin 루트 직접 폴더 생성**: 불필요한 공통 폴더 단계를 없애고 Joplin 최상위 노트북 레벨에 서적이 바로 생성되도록 경로 최적화.
- **변환 옵션(Frontmatter/INDEX) 삭제**: 사용률이 낮고 UI를 복잡하게 만들던 변환 옵션 체크박스 및 백엔드 파싱 제어 로직 제거.

### Fixed (Bugfixes)
- **Bugfix: Exporter 설정 카드 높이 잘림 문제 해결**: 설정 카드 오버플로우가 발생할 때 화면 스크롤이 차단되던 현상을 `.queue-section-card`에 `overflow-y: auto` 스타일을 부여하고 높이 제한을 상향하여 수정.
- **Bugfix: viewer-api 컨테이너 내 /app/data 볼륨 마운트 누락 수정**: 대상 도서 목록 드롭다운이 비어있는 오동작을 조사하여, `projects/viewer/docker/compose.yml` 내 `data` 볼륨 매핑 구문을 추가하여 복구 완료.
- **Bugfix: host.docker.internal 게이트웨이 해석 에러 해결**: 리눅스 Docker에서 호스트 Joplin 연동을 지원하기 위해 `projects/viewer/docker/compose.yml` 내에 `extra_hosts` 라우팅 설정 보완.

## [1.2.0] - 2026-06-20

### Changed
- **Monorepo Separation**: viewer compose 진입점을 `projects/viewer/docker/compose.yml`로 정렬하고 내부 빌드 컨텍스트를 유지. `projects/viewer/Makefile`에 `down` 타겟 추가 및 호환 구조 결합.
