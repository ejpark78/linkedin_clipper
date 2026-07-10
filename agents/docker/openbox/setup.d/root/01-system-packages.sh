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
  xz-utils
apt-get autoclean
rm -rf /var/lib/apt/lists/* /var/tmp/*
