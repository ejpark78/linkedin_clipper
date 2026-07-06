---
trigger: always_on
---

# 📋 Issue Workflow & Template Guidelines

## 1. 이슈 템플릿

모든 이슈는 `.agents/templates/`의 템플릿을 따라야 합니다.

### 1.1 새 이슈 생성 (`git:issue:new TEMPLATE="issue"` 또는 `git:issue:new -- --template issue`)
- 템플릿: `.agents/templates/issue.md`
- 단일 이슈의 목표, 배경(Context Memory), 해결방안, 참조를 구조화
- Ollama 사용 가능 시 Context Memory와 Solution을 자동 생성

### 1.2 에이전트 컨텍스트 저장 (`git:issue:save`)
- 템플릿: `.agents/templates/memory.md`
- 현재 세션의 전체 컨텍스트(커밋, 결정사항, 변경파일)를 Gitea 이슈로 저장
- Ollama가 Decisions 자동 추론 (없으면 빈칸)

## 2. 템플릿 구조

### issue.md
```
# {{TITLE}}
## 🎯 Goal
이 이슈의 해결 목표
## 🧠 Context Memory
이 결정을 내리게 된 배경/맥락
## ✅ Solution
구체적인 해결 방안
## 🔗 References
참조 이슈, 파일, PR
```

### memory.md
```
# Agent Context Memory: {{DATE}}
## 📊 Session Stats
커밋/변경 통계
## 📋 Issues & Decisions
세션 내 이슈별 결정사항
## 📁 Changed Files
변경된 파일 목록
```

## 3. 이슈 제목 형식

이슈 제목은 `{type}: {description}` 형식을 따릅니다.

| type | 용도 | 예시 |
|------|------|------|
| `feat:` | 새 기능/작업 계획 (Plan) | `feat: taskfile 네임스페이스 정리` |
| `fix:` | 버그 수정 | `fix: git:prune origin 인증 오류` |
| `docs:` | 문서/규칙 변경 | `docs: git flow merge/prune 규칙` |
| `session:` | 세션 요약 | `session: 2026-07-03` |

`git:` 접두사를 제목에 중복 사용하지 않습니다. 이미 `git:issue:new`로 생성하므로, 제목은 **무엇을 했는지(action)**에 집중합니다.

## 4. 에이전트 행동 규칙

- **Plan 승인 → 이슈 우선 생성**: 사용자가 Plan을 승인하면, 소스 코드 수정 전에 **반드시 먼저 `task git:issue:new`로 Plan 이슈를 생성**합니다. 구현이 먼저 이루어지고 이슈가 나중에 생성되는 것을 금지합니다.
- **새 작업 시작 시**: `task git:issue:new TEMPLATE="issue"` 또는 `task git:issue:new -- --template issue` 우선 사용
- **세션 종료 시**: `task git:issue:save`로 컨텍스트 저장
- **긴급/단순 작업**: 템플릿 생략 가능 (`task git:issue:new TITLE="..." BODY="..."` 또는 `task git:issue:new -- --title "..." --body "..."`)
- **기존 이슈 참조**: 이슈 본문에 `#NNN` 형식으로 관련 이슈 번호 명시
- **이슈 생성 후 구현**: 이슈 번호가 발급된 후에만 `GITEA_ISSUE_ID={#}`를 설정하고 코드 수정 및 커밋을 진행합니다.
