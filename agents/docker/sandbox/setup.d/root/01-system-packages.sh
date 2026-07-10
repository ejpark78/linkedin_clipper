#!/bin/bash
set -e

echo "**** Installing system packages ****"
apt-get update && apt-get install -y \
  sudo \
  dumb-init \
  locales \
  git \
  gzip \
  bzip2 \
  sqlite3 \
  wget \
  make \
  curl \
  zsh \
  tmux \
  docker.io \
  docker-buildx \
  docker-compose-v2 \
  jq \
  fontconfig \
  xz-utils \
  redis-tools \
  gnupg
apt-get autoclean
rm -rf /var/lib/apt/lists/* /var/tmp/*
