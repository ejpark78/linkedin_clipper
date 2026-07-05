FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_CACHE_DIR=/tmp/uv-cache
ENV UV_NO_VENV=1
ENV UV_FROZEN=1
ENV UV_PROJECT_ENVIRONMENT=/usr/local
ENV UV_NO_SYNC=1

WORKDIR /app

COPY apps/wiki/pyproject.toml apps/wiki/uv.lock /app/
RUN uv pip install --system --no-cache --prerelease=allow -r /app/pyproject.toml

COPY apps/wiki/src /app/src

WORKDIR /app

CMD ["streamlit", "run", "src/web/app.py", "--server.port=8501", "--server.headless=true", "--server.fileWatcherType=none"]
