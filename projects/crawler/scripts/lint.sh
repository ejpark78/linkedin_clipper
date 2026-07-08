#!/bin/bash
# ==============================================================================
# 🤖 projects/crawler/scripts/lint.sh
# ==============================================================================
# Description: Runs static verification (lint, type-check) for the crawler app.
#              Executes inside the worker container via Docker Compose run.
# ==============================================================================

set -e

# Docker 내부인지 판별
if [ -f /.dockerenv ]; then
  echo "🏃 [Docker context] Running crawler checks..."
  npm run lint --prefix projects/crawler
  npm run type-check --prefix projects/crawler
else
  # 호스트 환경인 경우 worker 이미지를 최신 수정 상태로 재빌드한 뒤 검증 수행
  echo "🐳 [Host context] Rebuilding worker container to apply configuration/source changes..."
  docker compose build worker
  
  echo "🐳 Running static checks inside newly built worker container..."
  docker compose run --rm -T worker npm run lint
  docker compose run --rm -T worker npm run type-check
fi
