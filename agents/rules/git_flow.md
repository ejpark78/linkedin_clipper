---
trigger: always_on
---

# Git Workflow (GitHub Flow)

이 프로젝트는 **GitHub Flow**를 따릅니다. 단순함이 핵심입니다.

---

## 1. 브랜치 전략

- **`main`**: 항상 배포 가능한 유일한 영구 브랜치. 직접 커밋 금지.
- **`feature/<name>`**: 기능 개발 브랜치. `main`에서 분기, 완료 후 `main`으로 병합.
- hotfix도 `feature/<name>`와 동일하게 처리. 별도 `hotfix/*` 브랜치 없음.
- `develop`, `release/*` 브랜치는 사용하지 않음.
- 릴리즈는 `main`에 tag로 표시.

## 2. 작업 흐름

```
main ──┬── feature/add-login ──▶ main (merge)
       ├── feature/refactor-db ─▶ main (merge)
       └── feature/fix-crash ───▶ main (merge)
```

1. `main`에서 `feature/<name>` 브랜치 생성
2. 기능 개발 후 `git add` + `git commit`
3. `main`으로 merge (로컬에서 직접 merge 또는 PR)
4. 병합 완료 후 `feature` 브랜치 삭제

## 3. 커밋 메시지

Conventional Commits 형식을 권장:
- `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`

## 4. 규칙

- `main`에 직접 커밋 금지
- 머지 전 lint/type-check 통과 권장
- 병합 완료된 feature 브랜치는 정리
