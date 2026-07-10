#!/usr/bin/env bash
set -e

echo "**** install nerd font ****"
mkdir -p /usr/local/share/fonts/jetbrains-mono
curl -fsSL -o /tmp/JetBrainsMono.tar.xz \
  "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.tar.xz"
tar -xJf /tmp/JetBrainsMono.tar.xz -C /usr/local/share/fonts/jetbrains-mono
fc-cache -f
rm -rf /tmp/JetBrainsMono.tar.xz
