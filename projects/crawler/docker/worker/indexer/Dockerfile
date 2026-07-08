# ==============================================================================
# 🐳 Module: Dockerfile (indexer)
# Description: Docker image build specification for Meilisearch indexer worker
# Last Updated: 2026-06-15
# ==============================================================================

FROM node:22-bookworm-slim

ARG BUILD_DATE
ARG VCS_REF

LABEL org.opencontainers.image.title="Indexer Worker"
LABEL org.opencontainers.image.description="Lightweight indexer worker for Meilisearch document indexing"
LABEL org.opencontainers.image.source="https://github.com/ejpark/scraper"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${VCS_REF}"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Bypass browser download during playwright installation (not needed for indexer)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies using cache layers
COPY package*.json tsconfig.json eslint.config.mjs ./
RUN npm install && npm cache clean --force

# Copy source files
COPY src/ ./
COPY src/ ./src/
COPY tests/ ./tests/

CMD ["npx", "ts-node", "workers/IndexerWorker.ts"]
