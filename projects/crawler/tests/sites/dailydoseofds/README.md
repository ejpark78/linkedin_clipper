# 🌐 Daily Dose of Data Science (dailydoseofds.com) 분석 보고서

## 1. 사이트 개요
- **성격**: 데이터 과학, 머신러닝, LLM 관련 튜토리얼 및 통찰을 제공하는 Ghost 기반 블로그.
- **주요 타겟**: `/archive/` (전체 글 목록), `/p/[slug]/` (상세 포스트).

## 2. 기술적 특징 및 수집 전략
### A. 목록 페이지 (`/archive/`)
- **구조**: `<article>` 태그를 통해 개별 포스트 리스트가 렌더링됨.
- **데이터 포인트**:
    - `href`: 상세 페이지 URL
    - `h2`: 포스트 제목
    - `time[datetime]`: 발행일
    - `span`: 카테고리/태그
- **페이지네이션**: 하단 `data-sx-pagination-btn` (Load more) 버튼을 통한 동적 로딩.
- **수집 전략**: Playwright를 이용하여 "Load more" 버튼을 반복 클릭하여 모든 URL을 추출하거나, Ghost 내부 API를 호출하는 방식 권장.

### B. 상세 페이지 (`/p/...`)
- **본문 영역**: 표준 HTML 태그(`p`, `h1-h6`, `ul`, `ol`, `img`)로 구성되어 있어 `turndown` 라이브러리로 Markdown 변환 시 매우 높은 정밀도 유지 가능.
- **핵심 셀렉터**: `<main>` 태그 또는 특정 본문 컨테이너.
- **특이사항**: 이미지 태그와 캡션이 포함되어 있어 이를 Markdown 이미지 문법(`![alt](src)`)으로 변환하는 정제 로직 필요.

## 3. 구현 계획 (개발 가이드)
1. **ListScraper**:
    - `/archive/` 페이지 접속 $\rightarrow$ `article` 태그 순회 $\rightarrow$ URL/제목/날짜 추출 $\rightarrow$ MongoDB 적재.
2. **Converter**:
    - `cheerio`로 본문 영역 추출 $\rightarrow$ `turndown`으로 Markdown 변환 $\rightarrow$ 정규표현식을 이용한 불필요한 HTML 잔재 및 특수 문자 정제.
3. **Pipeline**:
    - 기존 LinkedIn/PyTorchKR 파이프라인 구조를 재사용하여 `bronze` (HTML) $\rightarrow$ `silver` (MD) 변환 워크플로우 적용.

## 4. 테스트 환경
- **Fixtures**: `tests/sites/dailydoseofds/fixtures/` 내 실제 수집된 HTML 파일들이 포함되어 있어 로컬에서 즉시 변환 테스트 가능.
- **Test Case**: `Converter.test.ts`를 통해 제목 및 본문 추출 정밀도 검증.
