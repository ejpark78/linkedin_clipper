#!/usr/bin/env bash
set -e

echo "**** install tea ****"
ARCH_DIR=$(dpkg --print-architecture)
ARCH=$(dpkg --print-architecture | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')

if [ -s "/opt/cache/$ARCH_DIR/tea-linux-$ARCH" ]; then
  cp "/opt/cache/$ARCH_DIR/tea-linux-$ARCH" /usr/local/bin/tea
else
  curl -fsSL -o /usr/local/bin/tea "https://dl.gitea.com/tea/0.9.2/tea-0.9.2-linux-$ARCH"
fi
chmod +x /usr/local/bin/tea
