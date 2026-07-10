#!/bin/bash
set -e
CACHE=".cache"
ARCHS=("arm64" "amd64")
for ARCH in "${ARCHS[@]}"; do mkdir -p "$CACHE/$ARCH"; done

download() {
  local arch="$2"
  [ -z "$arch" ] && arch="$1"
  local file="$CACHE/$arch/$3"
  [ -s "$file" ] && echo "  EXISTS $file" && return 0
  echo "  DL $3"
  curl -fsSL -o "$file" "$1"
}

for ARCH in "${ARCHS[@]}"; do
  case "$ARCH" in
    arm64) TAR_ARCH=arm64; TEA_ARCH=arm64; TEA2_ARCH=arm64; MC_ARCH=arm64; JIRA_ARCH=arm64;;
    amd64) TAR_ARCH=x64; TEA_ARCH=amd64; TEA2_ARCH=x86_64; MC_ARCH=amd64; JIRA_ARCH=x86_64;;
  esac
  echo "[$ARCH]"
  download "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$TAR_ARCH.tar.gz" "$ARCH" "opencode-linux-$TAR_ARCH.tar.gz"
  download "https://dl.gitea.com/tea/0.9.2/tea-0.9.2-linux-$TEA_ARCH" "$ARCH" "tea-linux-$TEA_ARCH"
  download "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-$MC_ARCH" "$ARCH" "mkcert-linux-$MC_ARCH"
done
echo "[any]"
download "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.tar.xz" "arm64" "JetBrainsMono.tar.xz"
cp -n ".cache/arm64/JetBrainsMono.tar.xz" ".cache/amd64/JetBrainsMono.tar.xz" 2>/dev/null || true
echo "Done"
