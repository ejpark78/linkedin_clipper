# 🚀 Task Start Workflow

## Purpose
Ensure every coding session starts with a Gitea issue and user approval before any file modifications.

## Steps

### 1. Check / Create Gitea Issue
- Extract current branch name with `git rev-parse --abbrev-ref HEAD`
- If branch contains an issue number (e.g. `issue/123-xxx`), reuse that issue
- If no issue exists, create one via:
  `npm run gitea create-issue "<title>" "<body with [br] line breaks>"`
- Issue body must include: 목적, 변경 계획, 예상 파일 목록

### 2. Present Plan & Get Approval
- Present the issue link to the user
- Summarize the plan in chat
- **WAIT** for explicit user approval (Proceed button or "진행" message)

### 3. Execute (only after approval)
- Implement the changes
- Run verification (test/lint/type-check)

### 4. Close Issue (on completion)
- Use `npm run commit` which auto-closes via commit-changes.ts
- Or manually: comment completion details + `npm run gitea close-issue <#>`

## Exceptions
- Read-only exploration / information gathering: skip Steps 1-2
- Emergency hotfix (user explicitly says "urgent" / "hotfix"): skip Step 2
- User explicitly says "no issue needed": respect their request
