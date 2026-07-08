FROM python:3.13-slim

# Install uv (fast Python package manager)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
ENV UV_CACHE_DIR=/tmp/uv-cache
ENV UV_NO_VENV=1
ENV UV_FROZEN=1
ENV UV_PROJECT_ENVIRONMENT=/usr/local

# Install system dependencies if fitz/pymupdf needs them (usually fitz ships prebuilt wheels)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy lock files and project configs
COPY pyproject.toml uv.lock .

# Install dependencies globally inside container
RUN uv pip install --system -r pyproject.toml && rm -rf ${UV_CACHE_DIR}

# Copy source
COPY . .

CMD ["tail", "-f", "/dev/null"]
