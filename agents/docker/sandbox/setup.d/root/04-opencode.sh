#!/bin/bash
set -e
echo "Installing opencode..."
ARCH_DIR=$(dpkg --print-architecture)
ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/' | sed 's/aarch64/arm64/')

if [ -s "/opt/cache/$ARCH_DIR/opencode-linux-$ARCH.tar.gz" ]; then
    tar -xz -C /usr/local/bin opencode < "/opt/cache/$ARCH_DIR/opencode-linux-$ARCH.tar.gz"
else
    curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$ARCH.tar.gz" | \
    tar -xz -C /usr/local/bin opencode
fi
