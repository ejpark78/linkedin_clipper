#!/bin/bash
set -e
CACHE=".cache"
ARCHS=("arm64" "amd64")
for ARCH in "${ARCHS[@]}"; do mkdir -p "$CACHE/$ARCH"; done

download() {
  local file="$CACHE/$2/$3"
  [ -s "$file" ] && echo "  EXISTS $3" && return 0
  echo "  DL $3"
  curl -fsSL -o "$file" "$1"
}

for ARCH in "${ARCHS[@]}"; do
  case "$ARCH" in
    arm64) TAR_ARCH=arm64;;
    amd64) TAR_ARCH=x64;;
  esac
  echo "[$ARCH]"
  download "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$TAR_ARCH.tar.gz" "$ARCH" "opencode-linux-$TAR_ARCH.tar.gz"
done

download "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.tar.xz" "arm64" "JetBrainsMono.tar.xz"
cp -n ".cache/arm64/JetBrainsMono.tar.xz" ".cache/amd64/JetBrainsMono.tar.xz" 2>/dev/null || true
echo "Done"
