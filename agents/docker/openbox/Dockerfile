# syntax=docker/dockerfile:1
FROM ghcr.io/linuxserver/baseimage-selkies:debiantrixie

ENV TITLE="OpenBox" \
    NO_GAMEPAD=true \
    PIXELFLUX_WAYLAND=true

RUN apt-get update && \
  apt-get install --no-install-recommends -y \
    caja \
    chromium \
    chromium-l10n \
    git \
    gnome-keyring \
    ssh-askpass \
    stterm \
    xz-utils && \
  CODE_VERSION=$(curl -sL https://update.code.visualstudio.com/api/releases/stable \
    | awk -F'"' '{print $2}') && \
  curl -o \
    /tmp/code.deb -L \
    "https://update.code.visualstudio.com/${CODE_VERSION}/linux-deb-$(dpkg --print-architecture | sed 's/arm64/arm64/;s/amd64/x64/')/stable" && \
  DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y /tmp/code.deb && \
  echo "**** install brave ****" && \
  curl -fsSLo \
    /usr/share/keyrings/brave-browser-archive-keyring.gpg \
    https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg && \
  echo \
    "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" \
    > /etc/apt/sources.list.d/brave-browser-release.list && \
  apt-get update && \
  apt-get install -y --no-install-recommends \
    brave-browser && \
  echo "**** install obsidian ****" && \
  apt-get install -y --no-install-recommends \
    libgtk-3-bin \
    libatk1.0 \
    libatk-bridge2.0 \
    libnss3 \
    python3-xdg && \
  OBSIDIAN_VERSION=$(curl -sX GET "https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest" \
    | awk '/tag_name/{print $4;exit}' FS='[""]') && \
  OBSIDIAN_ARCH=$(dpkg --print-architecture | sed 's/amd64//;s/arm64/-arm64/') && \
  curl -o \
    /tmp/obsidian.app -L \
    "https://github.com/obsidianmd/obsidian-releases/releases/download/${OBSIDIAN_VERSION}/Obsidian-$(echo ${OBSIDIAN_VERSION} | sed 's/v//g')${OBSIDIAN_ARCH}.AppImage" && \
  chmod +x /tmp/obsidian.app && \
  /tmp/obsidian.app --appimage-extract && \
  mv squashfs-root /opt/obsidian && \
  cp \
    /opt/obsidian/usr/share/icons/hicolor/512x512/apps/obsidian.png \
    /usr/share/icons/hicolor/512x512/apps/obsidian.png && \
  echo "**** install nerd font ****" && \
  mkdir -p /usr/local/share/fonts/jetbrains-mono && \
  curl -fsSL -o \
    /tmp/JetBrainsMono.tar.xz \
    "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.tar.xz" && \
  tar -xJf /tmp/JetBrainsMono.tar.xz -C /usr/local/share/fonts/jetbrains-mono && \
  fc-cache -f && \
  apt-get autoclean && \
  rm -rf \
    /var/lib/apt/lists/* \
    /var/tmp/* \
    /tmp/*

COPY /root /

EXPOSE 3001
VOLUME /config
