# ==============================================================================
# 🐳 Module: Dockerfile (joplin-tool)
# Description: Docker image build specification for Joplin CLI tool
# Last Updated: 2026-07-02
# ==============================================================================

FROM node:22-bookworm

ARG BUILD_DATE
ARG VCS_REF

LABEL org.opencontainers.image.title="Scraper Joplin Tool"
LABEL org.opencontainers.image.description="Dockerized Joplin CLI tool for Scraper"
LABEL org.opencontainers.image.source="https://github.com/ejpark/scraper"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${VCS_REF}"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install Joplin CLI
RUN npm install -g joplin

# Copy configuration and source files
COPY package*.json tsconfig.json ./
RUN npm install && npm cache clean --force

COPY . .

CMD ["npx", "ts-node", "src/joplin.ts"]
