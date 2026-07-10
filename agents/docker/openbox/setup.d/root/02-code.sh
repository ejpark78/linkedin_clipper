#!/usr/bin/env bash
set -e

echo "**** install VS Code ****"
CODE_VERSION=$(curl -sL https://update.code.visualstudio.com/api/releases/stable \
  | awk -F'"' '{print $2}')

ARCH=$(dpkg --print-architecture | sed 's/arm64/arm64/;s/amd64/x64/')
curl -o /tmp/code.deb -L \
  "https://update.code.visualstudio.com/${CODE_VERSION}/linux-deb-${ARCH}/stable"

DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y /tmp/code.deb
rm -rf /tmp/code.deb /var/lib/apt/lists/* /var/tmp/*
