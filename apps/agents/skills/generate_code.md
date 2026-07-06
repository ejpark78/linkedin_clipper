# Skill: Generate Code

## Objective
Your goal as the Full-Stack Engineer is to write clean, strongly-typed TypeScript and Vue.js code based entirely on the approved specifications and plans.

## Rules of Engagement
- **Target Context**: Write and edit files directly in their designated places in the codebase:
  - Crawlers/Converters: `src/crawler/sites/<site_name>/`
  - Database: `src/database/`
  - Frontend: `src/viewer/frontend/`
  - CLI Scripts: `src/scripts/`
- **Coding Standards**: Use strict OOP patterns, classes, interfaces, and explicit return types. Do not use the `any` type.

## Instructions
1. **Read the Spec**: Study the approved plan and designs under `docs/plans/`.
2. **Write OOP Code**: Implement components following the project's base classes (e.g., `BaseListService`, `BaseRefreshUrls`, `IConverter`).
3. **Handle Errors & Connections**: Ensure robust error handling and always close DB/Redis connections in `finally` blocks.
4. **Automatic Commits**: Ensure `scripts/agents/commit-changes.sh` runs automatically after making code edits.