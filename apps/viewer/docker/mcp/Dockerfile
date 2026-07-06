# ==============================================================================
# 🐳 Module: Dockerfile (viewer-mcp)
# Description: Docker image build specification for MCP server
# Last Updated: 2026-06-16
# ==============================================================================

FROM node:22-bookworm

ARG BUILD_DATE
ARG VCS_REF

LABEL org.opencontainers.image.title="Scraper Viewer MCP"
LABEL org.opencontainers.image.description="MCP tool server for Scraper"
LABEL org.opencontainers.image.source="https://github.com/ejpark/scraper"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${VCS_REF}"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install root dependencies using cache layers
COPY package*.json tsconfig.json eslint.config.mjs ./
RUN npm install && npm cache clean --force

# Copy source files
COPY src/ ./
COPY src/ ./src/

CMD ["npx", "ts-node", "mcp/mcp-entry.ts"]
