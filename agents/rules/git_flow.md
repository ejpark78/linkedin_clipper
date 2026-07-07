---
trigger: always_on
---

# GitHub Flow 브랜치 전략 가이드 (git_flow.md)

이 가이드는 프로젝트의 브랜치 관리, 커밋 메시지 규칙, 그리고 작업 병합 절차를 규정합니다. 에이전트는 작업을 착수하고 완료할 때 본 규칙을 엄격히 따라야 합니다.

---

## 1. 브랜치 전략 (Branching Strategy)

작업 목적에 맞춰 명확한 브랜치를 분기하여 사용합니다.
* **`main`**: 항상 배포 가능한 유일한 영구 브랜치입니다. 직접 커밋이나 코드 수정이 절대 금지됩니다.
* **`feature/*`** 또는 **`feature/###-<name>`**: 기능 개발용 브랜치입니다. `main` 브랜치에서 분기하며, 아티팩트 작업 시 3자리 일련번호를 명명 규칙에 필수 포함해야 합니다. **이때 3자리 일련번호는 반드시 연동하려는 Gitea 이슈 번호와 정확히 일치해야 합니다.** (예: Gitea 이슈 #104 대응 시 `feature/104-ollama-native-migration`)
* **hotfix**도 `feature/`로 통일. 별도 `hotfix/*` 브랜치 없음.
* `develop`, `release/*` 브랜치는 사용하지 않음.
* 릴리즈는 `main`에 tag(`v{major}.{minor}.{patch}`)로 표시.

---

## 2. 커밋 메시지 규칙

[Conventional Commits](https://conventionalcommits.org) 규칙을 엄격히 준수합니다.
* **`feat:`**: 새로운 기능 추가 (예: `feat(065): add novel scraper`)
* **`fix:`**: 버그 수정 (예: `fix(012): handle null pointer in parser`)
* **`docs:`**: 문서 수정 (예: `docs: update setup manual`)
* **`refactor:`**: 코드 리팩터링 (성능 개선이나 구조 개선, 기능 변동 없음)
* **`chore:`**: 패키지 매니저 설정 변경, 빌드 업무, 기타 소스 코드에 직접 기여하지 않는 소소한 변경 사항

---

## 3. 작업 및 병합(Merge) 절차

1. **작업 시작 전**:
   - 로컬 환경의 `main` 브랜치를 원격지 최신 상태로 갱신해야 합니다 (`git pull`).
2. **브랜치 전환 전**:
   - 현재 브랜치에서 작업 중이던 코드가 유실되거나 꼬이지 않도록 `npm run git commit -w agents` (또는 `task git:commit`) 명령어를 먼저 실행하여 완전히 로컬 커밋을 완료하거나, `git stash`로 임시 보관해야 합니다.
3. **머지 충돌(Merge Conflict) 처리**:
   - 충돌이 발생하면 임의로 `--force` 옵션을 붙여 강제 푸시하는 행위는 절대 엄금합니다. 충돌 내역을 정밀 진단하고 스스로 해결하기 어려울 경우 사용자에게 즉시 알려 페어로 해결합니다.
4. **환경 검증**:
   - 코드 변경을 브랜치에 머지하거나 푸시하기 전에 Docker 컨테이너 내부에서 컴파일(빌드) 및 린트 검증이 통과하는지 확인해야 합니다.
5. **main 직접 제어 금지**:
   - 개발 과정 중 로컬 작업 시 `main` 브랜치로 직접 되돌아가거나 직접 커밋을 날리는 행위는 절대 금지됩니다.
6. **Git 히스토리 탐색 덤프 루프 방지**:
   - 히스토리 조회 시 단발성 명령어(`git log`, `git show`, `git reflog` 등)를 여러 턴에 걸쳐 쪼개어 반복 실행(덤프 루프)하지 마십시오. 삭제된 파일이나 변경 이력이 필요할 경우 한 번에 넓은 범위나 삭제 필터를 결합(`git log --diff-filter=D --summary` 등)하여 단일 턴에 탐색을 종결해야 합니다.
7. **브랜치 병합 절차**:
   - 기능 개발 완료 후 `task git:merge`로 자동 병합합니다.
   - 브랜치 타입과 무관하게 항상 현재 브랜치 → `main` 순으로 병합됩니다.
   - 필요시 직접 `task git:merge BRANCH="feature/xxx"`로 특정 브랜치를 지정할 수 있습니다.
8. **브랜치 정리 (Prune)**:
   - `main`에 이미 병합된 `feature/*` 브랜치는 주기적으로 정리합니다.
   - `task git:prune` 명령어로 일괄 삭제합니다. 내부적으로 다음을 수행합니다:
     - GitHub 최신 상태로 갱신
     - 병합 완료된 `feature/*` 로컬 브랜치 삭제
     - 원격 저장소의 사라진 브랜치 참조(ref) 정리
   - `release/*` 브랜치는 릴리즈 이력 보존을 위해 자동 정리 대상에서 제외됩니다.
9. **세션 컨텍스트 저장**:
   - 세션 종료 시 `npm run git issue:save` (또는 `task git:issue:save`)로 에이전트 컨텍스트 메모리를 Gitea 이슈로 저장합니다.
   - 저장 정보: 커밋 내역, 변경 파일, Decisions (Ollama 자동 추론), 관련 이슈
   - 템플릿: `.agents/templates/memory.md`

## 4. Git 헬퍼 스크립트
모든 Git/Gitea 작업은 통합 `agents/src/git/index.ts` 스크립트를 통해 실행합니다.
- `npm run git <command>` — 모든 서브커맨드 (create-issue, commit, review, push 등)
- 상세 커맨드 목록: `npm run git` (도움말 출력)
