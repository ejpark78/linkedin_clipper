#!/usr/bin/env bash
set -e

echo "**** install Node.js ****"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y --no-install-recommends nodejs
rm -rf /var/lib/apt/lists/* /var/tmp/*
