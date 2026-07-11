#!/usr/bin/env bash
set -e

echo "**** install agy, codex, joplin, kimi-code ****"
curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin
npm install -g @openai/codex joplin @moonshot-ai/kimi-code
