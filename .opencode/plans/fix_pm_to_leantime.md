# Fix: leantime task namespace (pm → leantime)

## 변경 사항

### 1. `Taskfile.yml` (루트) — 50번째 줄
```yaml
# BEFORE
  pm:
    taskfile: ./agents/docker/leantime/Taskfile.yml
    dir: .

# AFTER
  leantime:
    taskfile: ./agents/docker/leantime/Taskfile.yml
    dir: .
```

### 2. `agents/docker/leantime/Taskfile.yml` — 5곳 수정
```yaml
# BEFORE                    →  AFTER
task pm:up                  →  task leantime:up
- task pm:down              →  - task leantime:down
- task pm:logs              →  - task leantime:logs
- task pm:init              →  - task leantime:init
1. task pm:up 으로 컨테이너  →  1. task leantime:up 으로 컨테이너
```

### 적용 후 사용법
```bash
task leantime:init    # SSL 인증서 + 컨테이너 실행
task leantime:logs    # 로그 확인
task leantime:down    # 중지
```

**URL, compose 내용, Dockerfile — 모두 그대로입니다.**
