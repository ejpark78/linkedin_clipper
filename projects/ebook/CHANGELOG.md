# Changelog - Ebook Processing Service (`projects/ebook`)

All notable changes to the ebook processing service (PDF to Markdown conversion and analysis) will be documented in this file.

---

## [1.6.0] - 2026-06-22

### Changed
- **projects/ebook 구조 단순화 및 CLI 진입점 통합**: 복잡한 OOP Command 패턴(`EbookCommand`)을 걷어내고 CLI 진입점을 `main.py` 단일 파일로 단순화 및 병합. `commands.py`를 삭제하고 각 실행부(Summary, Analyze, HTML 변환, MD 변환, Split)를 `main.py` 내부의 단순 함수 구조로 이식.
- `process.py` -> `main.py`로 이름을 변경하여 CLI 진입점 역할을 명확화.
- `pyproject.toml` 및 `Makefile` 내의 poe tasks, make targets 실행 경로를 `src.main`으로 갱신.
- **main.py OOP 리팩토링**: `main.py` 내에 정의된 로직들을 OOP 규칙 및 단일 책임 원칙(SRP)에 맞춰 `EbookPipeline`(비즈니스 로직 캡슐화) 및 `EbookCLI`(CLI 매개변수 바인딩 및 파싱 제어) 클래스로 리팩토링 및 캡슐화.
- **상수 이식**: `constants.py`가 제거됨에 따라, 유일한 참조처였던 `analyzer.py` 내부에 `EXCLUDE_TITLES` 상수를 로컬로 내장 정의.

### Removed
- **미사용 번역 기능 제거**: 현재 사용하지 않는 PDF/Markdown 번역 기능인 `translator.py`, `translate_batch.py` 파일을 제거하고 `Makefile` 및 `pyproject.toml`에서 번역 관련 명령어(`translate_md`, `translate_batch`)를 삭제.
- **데드 코드 정리**: 파이프라인에서 사용되지 않는 `pdf_parser.py` 및 단일 상수 래퍼 `constants.py`를 제거하고, 해당 파일에 의존하던 `tests/test_column_detector.py`, `tests/test_text_cleaner.py` 테스트 코드를 영구 삭제.

### Fixed (Bugfixes)
- **Bugfix: 단위 테스트 Mock 구성 오류 수정**: `tests/test_analyzer.py`에서 디렉토리 재귀 분석(`test_analyze_directory_recursion`) 시 Mock 우회 문제로 인한 `call_count` 검출 실패 및 Regex chapter detection 테스트(`test_overwrite_skip_logic_true`) 시 Mock 객체 반환으로 인한 `TypeError` 오류를 Mock 구조 정밀화 및 `side_effect` 분기 처리를 통해 수정 완료.

## [1.5.0] - 2026-06-21

### Changed
- **projects/ebook 리팩토링 (Phase 1~4)**: 중복 코드 제거, 일관성 개선, 테스트/린터 인프라를 전면 도입.
  - **Phase 1 (클린업)**: `EXCLUDE_TITLES`를 `src/constants.py` 중앙 상수로 분리 (`pdf_analyzer.py`, `pdf_to_markdown.py`에서 중복 제거); `process.py`의 중복 `ArgumentParser` 제거; 파일 탐색 로직을 `_collect_files()` / `_resolve_file_arg()` 헬퍼로 추출.
  - **Phase 2 (일관성)**: `HTMLConverter` / `HTMLToMarkdownConverter`가 output 디렉토리에 결과를 저장하도록 수정 (기존 source 옆 저장); `pdf_translator.py` 모듈 레벨 상수 제거 (Docker 호환성을 위해 생성자 기본값만 유지); `pyproject.toml`에 누락 의존성(`google-generativeai`, `openai`, `python-dotenv`, `pytest`) 및 `[tool.ruff]` / `[tool.pytest]` 설정 추가.
  - **Phase 3 (품질)**: `tests/test_text_cleaner.py` (23개), `tests/test_splitter_utils.py` (7개), `tests/test_column_detector.py` (4개) 총 30개 단위 테스트 작성 (pytest); `README.md` 신규 작성.
  - **Phase 4 (Command 패턴)**: `main()` 165줄 → 15줄로 단축. 7개 모드를 `src/commands.py`의 `EbookCommand` 추상 클래스 기반 6개 Command 클래스로 분리.

## [1.1.0] - 2026-06-19

### Added
- **Ebook Parser & Python Layout Service**: Python 3.13 및 `uv` 도구를 바탕으로 서적 PDF 레이아웃 분석 및 마크다운 정제 모듈을 포함하는 독립 `projects/ebook` 패키지 구성.
