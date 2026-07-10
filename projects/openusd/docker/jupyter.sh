#!/bin/bash
set -e

NOTEBOOK_DIR="/app/docs/_build/jupyter_execute"

if [ -d "$NOTEBOOK_DIR" ] && [ "$(find "$NOTEBOOK_DIR" -name '*.ipynb' -type f 2>/dev/null | head -c1 | wc -c)" -gt 0 ]; then
    echo "==> Notebooks already exist at $NOTEBOOK_DIR"
else
    mkdir -p "$NOTEBOOK_DIR"
    echo "==> No notebooks found. Run 'uv run sphinx-build -M html docs/ docs/_build/' to generate them."
fi

/opt/venv/bin/jupyter lab \
    --ip=0.0.0.0 \
    --port=8888 \
    --no-browser \
    --NotebookApp.token='' \
    --NotebookApp.password='' \
    --allow-root \
    --notebook-dir="$NOTEBOOK_DIR" \
    --MappingKernelManager.kernel_info_timeout=300 \
    --ServerApp.websocket_ping_timeout=120 \
    --ServerApp.disable_check_xsrf=True
