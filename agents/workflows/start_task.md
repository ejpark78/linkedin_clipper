# 🚀 Task Start Workflow

## Steps

### 1. Plan & Approval
- 작업 계획을 사용자에게 제시
- **WAIT** for explicit user approval (Proceed button or "진행" message)

### 2. Execute (only after approval)
- `git checkout main && git pull && git checkout -b feature/<name>` (새 기능 브랜치)
- Implement the changes
- `git add -A && git commit -m "<type>: <desc>" && git push`
- Return to main: `git checkout main && git merge feature/<name> && git branch -d feature/<name>`

### 3. Issue Tracking (optional)
- 필요시 curl로 Gitea 이슈 생성:
  `curl -sk -X POST "$GITEA_API_URL/repos/$GITEA_REPO/issues" -H "Authorization: token $GITEA_ACCESS_TOKEN" -H "Content-Type: application/json" -d '{"title":"...","body":"..."}'`

## Exceptions
- Read-only exploration: skip Steps 1-2
- User says "no issue needed": respect their request
