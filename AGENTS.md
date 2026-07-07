# 🤖 Agent Project Rules (Monorepo Root)

## 🎯 Project Vision

이 프로젝트는 LinkedIn, 기술 뉴스레터, 기술 서적 등 분산된 기술 정보를 수집·구조화하여 개발자를 위한 통합 기술 지식 허브를 구축합니다. 수집 → 정제 → 검색 → LLM 분석 파이프라인을 모노레포 환경에서 운영합니다.

---

## 📖 Primary Rules

에이전트 운영 규칙은 `agents/AGENTS.md`를 최우선으로 따릅니다:

1. **[Primary Agent Rules](agents/AGENTS.md)**
2. [Agent Rules](agents/rules/) (GitHub Flow, Issue Workflow, Engineering, Tech Stack 등)
3. [Agent Skills](agents/skills/)
4. [Agent Workflows](agents/workflows/)

> 💡 `agents/` 디렉토리는 self-contained 모듈로, 신규 프로젝트에 복사하여 바로 사용할 수 있습니다.

---

## 🏗️ Monorepo Context

### 앱 구조
| 앱 | 설명 |
|:---|:---|
| `apps/crawler/` | LinkedIn 등 기술 컨텐츠 크롤링 파이프라인 |
| `apps/viewer/` | 수집된 컨텐츠 웹 뷰어 |
| `apps/wiki/` | 지식베이스 위키 (Obsidian + Joplin) |
| `apps/ebook/` | 전자책 생성 파이프라인 |

### 인프라
- `infra/mongodb/`, `infra/redis/`, `infra/meilisearch/` — 데이터 계층
- Docker Compose 기반 실행 (`compose.yml`)
- Traefik + mkcert 역방향 프록시 (agents/docker/traefik)
- Gitea 로컬 Git 호스팅 (agents/docker/gitea)

### Docker 실행 정책
- **Docker 중심 테스트 및 실행**: `docker compose` 내부망에서 실행 및 진단
- **Python 및 uv 가상환경**: `uv run` 또는 `docker compose` 컨텍스트 내 실행
- **데이터 변경 및 인프라 제어**: 주요 변경은 사용자에게 수동 실행 요청

### 보안 규칙
- **ENV 접근 금지**: `.env` 파일 직접 접근 금지, `.env.example` 참조
- **자격 증명 노출 금지**: API 키/패스워드 출력 노출 금지
- **MCP 설정 제약**: `.mcp.json` 파일 쓰기/민감 정보 하드코딩 금지

---

## 💡 Token Efficiency Rules
1. **아티팩트 사전 스캔 금지**: `docs/artifacts/` 문서 자동 읽지 않음
2. **AGENTS.md 유지보수**: 불필요한 예제/중복 발견 시 능동적으로 정리
