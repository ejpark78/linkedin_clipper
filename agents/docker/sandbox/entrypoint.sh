#!/bin/bash
set -e

# Run init scripts before launching code-server
if [ -d "/etc/init-scripts" ]; then
    for script in $(ls /etc/init-scripts/ 2>/dev/null | sort); do
        script_path="/etc/init-scripts/$script"
        if [ -f "$script_path" ] && [ -x "$script_path" ]; then
            echo "[init] Running $script"
            "$script_path"
        fi
    done
fi

exec dumb-init code-server "$@"
