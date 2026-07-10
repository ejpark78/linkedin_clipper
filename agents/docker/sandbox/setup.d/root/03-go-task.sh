#!/bin/bash
set -e
echo "Installing go-task..."
sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
