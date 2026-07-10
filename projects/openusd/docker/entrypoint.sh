#!/bin/bash
set -e

if [ "$(id -u)" != "0" ]; then
    exec sudo "$0" "$@"
fi

if [ -d "/etc/init-scripts" ]; then
    for script in $(ls /etc/init-scripts/ 2>/dev/null | sort); do
        script_path="/etc/init-scripts/$script"
        if [ -f "$script_path" ] && [ -x "$script_path" ]; then
            echo "[init] Running $script"
            "$script_path"
        fi
    done
fi

NOTEBOOK_DIR="/app/docs/_build/jupyter_execute"
if [ -d "$NOTEBOOK_DIR" ] && [ "$(find "$NOTEBOOK_DIR" -name '*.ipynb' -type f 2>/dev/null | head -c1 | wc -c)" -gt 0 ]; then
    echo "==> Notebooks already exist at $NOTEBOOK_DIR"
else
    mkdir -p "$NOTEBOOK_DIR"
    echo "==> No notebooks found. Run 'uv run sphinx-build -M html docs/ docs/_build/' to generate them."
fi

echo "==> Jupyter: run ~/jupyter.sh in code-server terminal"
exec sudo -u ubuntu -H code-server --bind-addr 0.0.0.0:8080 --auth none
