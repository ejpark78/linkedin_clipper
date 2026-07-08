# 📘 Ebook Pipeline

## 개요
(PDF, EPUB) → split → (PDF, html) → 2html → (html) → 2md → (markdown)

## 주요 명령어
| 명령어 | 기본값 파라미터가 명시된 Task 실행 형식 | 설명 |
|--------|----------------------------------------|------|
| `task ebook:analyze` | `task ebook:analyze RAW=data/raw OVERWRITE=false` | PDF/EPUB 파일 또는 디렉토리 하위의 파일들에서 구조 분석 및 TOC 추출 (`books.json` 저장) |
| `task ebook:split` | `task ebook:split RAW=data/raw OUT_PATH=data/output` | PDF/EPUB → 챕터별 파일 분할 (PDF→PDF, EPUB→HTML) |
| `task ebook:2html` | `task ebook:2html OUT_PATH=data/output` | PDF/EPUB → HTML 변환 |
| `task ebook:2md` | `task ebook:2md OUT_PATH=data/output` | HTML → Markdown 변환 |
| `npm run test` | `npm run test` | pytest 실행 (projects/ebook) |
| **통합 파이프라인 검증** | `task ebook:build && task ebook:split RAW=data/raw OUT_PATH=data/output && task ebook:2html OUT_PATH=data/output && task ebook:2md OUT_PATH=data/output` | 이미지 빌드부터 분할, HTML 변환, Markdown 최종 변환까지 전체 파이프라인을 일괄 통합 테스트 및 검증 |

## 출력 파일 규칙
- 변환 결과는 **입력 파일과 동일한 디렉토리**에 저장
  - `chapter.pdf` → `chapter.html` (with_suffix)
  - `chapter.html` → `chapter.md` (with_suffix)
  - `chapter.epub` → `chapter.html` (내부 HTML 추출)
- 이미지는 `images/` 서브디렉토리에 저장 (입력 파일 기준 상대 경로)
- 출력 폴더명 = raw 파일명에서 `.pdf`/`.epub` 제거 (`get_output_path()`)

## 확장자별 처리

| 명령어 | `.pdf` | `.epub` | `.html` |
|--------|--------|---------|---------|
| `--split` | fitz 페이지 범위 분할 | ebooklib 내부 문서 추출 | — |
| `--to-html` | HTMLConverter (PyMuPDF) | ebooklib 내부 HTML 추출 | — |
| `--to-md` | HTML→MD 2단계 (중간html 유지) | HTML→MD 2단계 | HTMLToMarkdownConverter |

## Task 변수
- `OUT_PATH=data/output` — split/convert 작업 디렉토리 (파이썬 스크립트의 `--path` 인자 매핑)
- `RAW=data/raw` — 원본 PDF/EPUB 디렉토리 (파이썬 스크립트의 `--raw` 인자 매핑)

## Permission 이슈 해결
- `ENV UV_FROZEN=1` — `uv run`이 lock 파일 검증/갱신 시도로 발생하는 Permission denied 해결
- `ENV UV_CACHE_DIR=/tmp/uv-cache` — non-root 사용자도 쓸 수 있는 캐시 경로
- `ENV UV_PROJECT_ENVIRONMENT=/usr/local` — `.venv` 생성 회피, system Python 사용
- `RUN_USER` — Docker 컨테이너를 host 사용자 권한으로 실행 (파일 소유권 일관성)
- Task `OUT_PATH` 기본값 `data/output` (마운트된 볼륨 내 경로, writable)

## 아키텍처
- `main.py` — CLI 진입점(`EbookCLI`) 및 코어 비즈니스 로직(`EbookPipeline`)의 OOP 구조로 캡슐화
- `ChapterSplitter` — PDF(페이지) / EPUB(내부 문서) 분할
- `HTMLConverter` (`html_parser.py`) — PDF → HTML (PyMuPDF)
- `HTMLToMarkdownConverter` (`markdown_parser.py`) — HTML → MD (BeautifulSoup + markdownify)
- `get_output_path(filename)` — `.pdf`/`.epub` 제거한 순수 파일명 반환

## 설정 및 분석 (Analyze)
- `books.json`: 파일명을 key, `chapters[]`에 title/start/end/include 정보를 보관합니다.
- `--analyze` / `task ebook:analyze`: 
  - 단일 파일 또는 디렉토리 경로를 인자로 받습니다.
  - 디렉토리가 전달될 경우, 하위의 모든 `.pdf` 및 `.epub` 파일을 재귀적으로 검색하여 TOC를 분석합니다.
  - 대화형 TTY 환경이 아닐 경우(배치 혹은 비대화형 실행), 사용자 입력창을 띄우지 않고 기본 추천 챕터 범위를 자동으로 계산해 `books.json`에 즉각 저장합니다.
  - 기존에 `books.json`에 이미 분석된 데이터가 존재하는 도서는 비대화형 모드에서는 덮어쓰지 않고 스킵하여 안전하게 보존합니다.
- `--path data/output`: split 결과물 및 convert 입출력 경로로 사용됩니다.

## 변경 이력
- 상세 변경 내역은 [CHANGELOG.md](CHANGELOG.md)를 참고하세요.
