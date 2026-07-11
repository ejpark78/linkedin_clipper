#!/usr/bin/env bash
set -e

echo "**** install system packages ****"
apt-get update
apt-get install --no-install-recommends -y \
  caja \
  chromium \
  chromium-l10n \
  git \
  gnome-keyring \
  ssh-askpass \
  stterm \
  xz-utils \
  zsh \
  jq \
  docker.io \
  fuse-overlayfs \
  fonts-noto-cjk \
  libnss3-tools \
  python3 \
  python3-pip \
  python3-venv \
  build-essential \
  pkg-config \
  xclip
apt-get autoclean
rm -rf /var/lib/apt/lists/* /var/tmp/*
