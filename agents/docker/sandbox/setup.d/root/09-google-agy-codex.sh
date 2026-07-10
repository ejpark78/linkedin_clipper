#!/bin/bash
set -e
echo "Installing agy, codex, joplin, kimi-code..."
curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin
npm install -g @openai/codex joplin @moonshot-ai/kimi-code
