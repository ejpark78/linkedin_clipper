# ==============================================================================
# 🐳 Module: Dockerfile (base)
# Description: Docker image build specification for base runner
# Last Updated: 2026-06-11
# ==============================================================================

FROM mcr.microsoft.com/playwright:v1.61.0-jammy

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

ARG BUILD_DATE
ARG VCS_REF

LABEL org.opencontainers.image.title="LinkedIn Clipper Base"
LABEL org.opencontainers.image.description="Playwright-based CLI runner for LinkedIn jobs and tech news scraping"
LABEL org.opencontainers.image.source="https://github.com/ejpark/linkedin"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${VCS_REF}"
LABEL org.opencontainers.image.licenses="MIT"

# Install Korean fonts
RUN apt-get update && apt-get install -y \
    fonts-nanum \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies using cache layers
COPY package*.json tsconfig.json eslint.config.mjs ./
RUN npm install --legacy-peer-deps && npm cache clean --force

# Copy source files
COPY src/ ./
COPY src/ ./src/
COPY tests/ ./tests/

# Precreate data and config directories
RUN mkdir -p data config

CMD ["tail", "-f", "/dev/null"]
