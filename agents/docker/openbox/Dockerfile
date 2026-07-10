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
    stterm && \
  CODE_VERSION=$(curl -sL https://update.code.visualstudio.com/api/releases/stable \
    | awk -F'"' '{print $2}') && \
  curl -o \
    /tmp/code.deb -L \
    "https://update.code.visualstudio.com/${CODE_VERSION}/linux-deb-$(dpkg --print-architecture | sed 's/arm64/arm64/;s/amd64/x64/')/stable" && \
  DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y /tmp/code.deb && \
  apt-get autoclean && \
  rm -rf \
    /var/lib/apt/lists/* \
    /var/tmp/* \
    /tmp/*

COPY /root /

EXPOSE 3001
VOLUME /config
