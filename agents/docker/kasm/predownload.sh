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
    arm64) TAR_ARCH=arm64; DEB_ARCH=arm64; CURSOR_ARCH=arm64; ANTIGRAVITY_ARCH=linux-arm;;
    amd64) TAR_ARCH=x64; DEB_ARCH=amd64; CURSOR_ARCH=x64; ANTIGRAVITY_ARCH=linux-x64;;
  esac
  echo "[$ARCH]"
  download "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$TAR_ARCH.tar.gz" "$ARCH" "opencode-linux-$TAR_ARCH.tar.gz"
  download "https://github.com/anomalyco/opencode/releases/latest/download/opencode-desktop-linux-$DEB_ARCH.deb" "$ARCH" "opencode-desktop-linux-$DEB_ARCH.deb"
  download "https://api2.cursor.sh/updates/download/golden/linux-${CURSOR_ARCH}-deb/cursor/latest" "$ARCH" "cursor-linux-${CURSOR_ARCH}.deb"
  download "https://storage.googleapis.com/antigravity-public/antigravity-hub/2.2.1-5287492581195776/${ANTIGRAVITY_ARCH}/Antigravity.tar.gz" "$ARCH" "antigravity-$ANTIGRAVITY_ARCH.tar.gz"
done

if [ "$(uname -m)" = "x86_64" ] || [ "$(uname -m)" = "amd64" ]; then
  echo "[amd64 only]"
  download "https://windsurf-stable.codeiumdata.com/linux-x64-deb/stable/0d4bf12ed4a7597cb8ae9016fe8474468aad98a2/Devin-linux-x64-3.4.27.deb" "amd64" "devin.deb"
  download "https://prod.download.desktop.kiro.dev/releases/stable/linux-x64/signed/1.0.89/deb/kiro-ide-1.0.89-stable-linux-x64.deb" "amd64" "kiro.deb"
fi
echo "Done"
