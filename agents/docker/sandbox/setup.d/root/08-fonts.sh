#!/bin/bash
set -e
echo "Installing Nerd Fonts..."
ARCH_DIR=$(dpkg --print-architecture)
mkdir -p /usr/local/share/fonts/jetbrains-mono

if [ -s "/opt/cache/$ARCH_DIR/JetBrainsMono.tar.xz" ]; then
    tar -xJ -C /usr/local/share/fonts/jetbrains-mono < "/opt/cache/$ARCH_DIR/JetBrainsMono.tar.xz"
else
    curl -fsSL https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.tar.xz | \
    tar -xJ -C /usr/local/share/fonts/jetbrains-mono
fi
fc-cache -f
