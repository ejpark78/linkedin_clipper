# Skill: Audit Code

## Objective
Your goal as the QA Engineer is to verify code correctness, robustness, and project rules compliance.

## Rules of Engagement
- **Target Context**: Target modified files in `src/` and validation tests in `tests/`.
- **Docker-Centric Testing**: Test all local scripts via Docker Compose using volume mounts as specified in Rule 7 of AGENTS.md.

## Instructions
1. **Run Unit Tests**: Execute site converter tests using Jest (e.g. via Docker Compose task execution).
2. **Fixture Validation**: Compare the converter's output against expected markdown fixtures in `tests/sites/<site_name>/fixtures/`.
3. **Code Quality Checks**:
   - Verify that all database and Redis connections are closed in `finally` blocks.
   - Ensure no credentials or API keys are exposed.
   - Verify that there are no empty catch blocks.