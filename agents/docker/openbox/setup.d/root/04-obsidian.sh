#!/usr/bin/env bash
set -e

echo "**** install obsidian ****"
apt-get update
apt-get install -y --no-install-recommends \
  libgtk-3-bin \
  libatk1.0 \
  libatk-bridge2.0 \
  libnss3 \
  python3-xdg

OBSIDIAN_VERSION=$(curl -sX GET "https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest" \
  | awk '/tag_name/{print $4;exit}' FS='[""]')

OBSIDIAN_ARCH=$(dpkg --print-architecture | sed 's/amd64//;s/arm64/-arm64/')

curl -o /tmp/obsidian.app -L \
  "https://github.com/obsidianmd/obsidian-releases/releases/download/${OBSIDIAN_VERSION}/Obsidian-$(echo ${OBSIDIAN_VERSION} | sed 's/v//g')${OBSIDIAN_ARCH}.AppImage"

chmod +x /tmp/obsidian.app
/tmp/obsidian.app --appimage-extract
mv squashfs-root /opt/obsidian
cp \
  /opt/obsidian/usr/share/icons/hicolor/512x512/apps/obsidian.png \
  /usr/share/icons/hicolor/512x512/apps/obsidian.png

# Obsidian desktop entry 등록 (panel/launcher 인식용)
cp /opt/obsidian/obsidian.desktop /usr/share/applications/obsidian.desktop
sed -i 's|Exec=AppRun|Exec=/usr/bin/obsidian|' /usr/share/applications/obsidian.desktop
update-desktop-database /usr/share/applications 2>/dev/null || true

rm -rf /tmp/obsidian.app /var/lib/apt/lists/* /var/tmp/*
