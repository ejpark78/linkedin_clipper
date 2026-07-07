# 🤖 Agent Project Rules (agents/AGENTS.md)

## 🎯 Project Vision

이 프로젝트는 기술 정보 수집, 에이전트 관리, LLM 기반 분석 파이프라인을 운영합니다.

---

## ⚠️ 주요 제약 사항

### 0. 규칙 우선순위
이 저장소의 운영 규칙은 다음 우선순위로 해석합니다.
1. `AGENTS.md` (루트)
2. `agents/AGENTS.md`
3. `agents/rules/*.md`
4. `agents/skills/*.md`
5. `agents/workflows/*.md`

### 1. 운영 및 승인 프로세스
* **임의 Bash 명령어 금지**: Pre-Approved 명령어를 제외한 모든 셸 명령어(읽기 전용 진단, git, docker, ls, env 등 포함)는 사용자의 명시적 승인이 필요합니다.
* **Gitea 이슈 기반 단일 계획 수립 및 자율 일괄 실행**:
  * Plan(계획서)이 구체화되는 시점에 Gitea 이슈를 생성해 작업 범위와 목표를 고정합니다.
  * 작업 범위가 바뀌면 기존 이슈를 종료하고 새 이슈를 생성합니다.
  * 작업 완료 시 이슈를 종료합니다.
  * Plan 계획서 및 분석 결과를 이슈 본문에 포함합니다.
  * 소스 코드 수정 전에 반드시 Gitea 이슈를 먼저 생성합니다.
  * 세션 시작 시 최신 규칙 파일을 사전 스캔합니다.
* **Gitea API 및 헬퍼 스크립트 활용**: `task git:*` 래퍼를 우선 사용합니다.
* **Gitea 이슈 title/body 작성 규칙**: title과 body는 반드시 파일로 전달해야 합니다.
* **일관된 릴리즈 및 이슈 자동 종결**: 작업 완료 후 `npm run commit`으로 일괄 처리합니다.
* **항상 `npm run commit`으로 마감**합니다.
* **완료 보고의 구체성**: 해결책, 수정 파일, 동작 방식, 검증 결과를 명시합니다.
* **승인 전 편집 금지**: 사용자 승인 전 소스 코드 수정을 금지합니다.
* **자율 일괄 실행**: 승인 후 추가 승인 없이 자율 처리합니다.
* **이슈 완료 후 보완 시 재오픈**: 신규 이슈 대신 기존 이슈를 재오픈합니다.
* **동시 백그라운드 작업 금지**: 경쟁 상태 방지.
* **투명한 이슈 처리**: 오류 즉시 보고, 무음 복구 금지.
* **명령어 실행 에러 공개**: 모든 비정상 종료를 사용자에게 공개합니다.
* **AI 처리 및 응답 한국어**: 모든 AI 로그, 상태 메시지, 채팅 응답은 한국어.

### 2. 코드 검증 및 런타임 제약
* **Docker 중심 테스트 및 실행**: 로컬 스크립트는 `docker compose` 내부망에서 실행.
* **Python 및 uv 가상환경 실행**: `uv run` 또는 `docker compose` 컨텍스트 내에서 실행.
* **데이터 변경 및 인프라 제어 사용자 위임**: 주요 변경은 사용자에게 수동 실행 요청.
* **최소 파일 범위 및 커버리지**: 루트 레벨 grep/재귀 list_dir 회피, `git ls-files` 1회 후 직접 Read.
* **범위 외 수정 금지**: 명시적 요청 외 파일 수정 금지.

### 3. Git 및 협업 방식
* **Git Flow 브랜치 전략 준수**: `main` 직접 수정 금지, [Git Flow Guide](agents/rules/git_flow.md) 참조.
* **자동 Git 커밋**: 유효한 편집 직후 `npm run commit` 실행.
* **상대경로 링크 사용**: 문서 내 상대경로 사용, `file://` scheme 금지.

---

## ⚠️ 보안 규칙
- **ENV 접근 금지**: `.env` 또는 `.env.*` 파일 직접 접근/쓰기 금지.
- **자격 증명 노출 금지**: API 키/패스워드를 출력에 노출 금지.

---

## 🛠️ 기술 스택별 작업 규칙
* **코딩 규칙 준수**: strict typing(`any` 금지), class OOP 설계, [Tech Stack Guide](agents/rules/tech_stack.md) 참조.
* **공통 엔지니어링 규칙**: [Engineering & Architecture Guide](agents/rules/engineering_architecture.md) 참조.

---

## 🧭 Agent Skill Directory Map

| 컨텍스트 | Skill 파일 | 설명 |
|:---|:---|:---|
| 사이트 크롤러/파이프라인 | [develop_sites_skills.md](agents/skills/develop_sites_skills.md) | Bronze→Silver 파이프라인 |
| DB/인덱스 | [database_skills.md](agents/skills/database_skills.md) | MongoDB/Redis 스키마 |
| HTML/스크래핑 디버깅 | [html_debugging_skills.md](agents/skills/html_debugging_skills.md) | HtmlDebugger 유틸 |

---

## 💡 Token Efficiency Rules
1. **아티팩트 사전 스캔 금지**: `docs/artifacts/` 문서는 자동으로 읽지 않음.
2. **AGENTS.md 유지보수**: 불필요한 예제/중복 발견 시 능동적으로 정리.

---

## 🔓 사전 승인 명령어
- `git ls-files`
- `npm run git`
- `npm run git commit`
- `npm run git review`
- `npm run git push`
- `npx ts-node agents/src/git/index.ts`
- `task`
