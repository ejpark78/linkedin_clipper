# 🚀 Task Start Workflow

## Purpose
Ensure every coding session starts with a Gitea issue and user approval before any file modifications.

## Steps

### 1. Check / Create Gitea Issue
- Extract current branch name with `git rev-parse --abbrev-ref HEAD`
- If branch contains an issue number (e.g. `issue/123-xxx`), reuse that issue
- If no issue exists, create one via:
  `npm run git create-issue --title-file=<path> --body-file=<path>`
- Issue body must include: 목적, 변경 계획, 예상 파일 목록

### 2. Present Plan & Get Approval
- Present the issue link to the user
- Summarize the plan in chat
- **WAIT** for explicit user approval (Proceed button or "진행" message)

### 3. Execute (only after approval)
- Implement the changes
- Run verification (test/lint/type-check)

### 4. Close Issue (on completion)
- Use `npm run git commit` which auto-closes via git/index.ts
- Or manually: comment completion details + `npm run git close-issue --issue=<number>`

## Exceptions
- Read-only exploration / information gathering: skip Steps 1-2
- User explicitly says "no issue needed": respect their request
