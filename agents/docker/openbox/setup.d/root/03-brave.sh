#!/usr/bin/env bash
set -e

echo "**** install brave ****"
curl -fsSLo \
  /usr/share/keyrings/brave-browser-archive-keyring.gpg \
  https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg

echo \
  "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" \
  > /etc/apt/sources.list.d/brave-browser-release.list

apt-get update
apt-get install -y --no-install-recommends brave-browser
rm -rf /var/lib/apt/lists/* /var/tmp/*
