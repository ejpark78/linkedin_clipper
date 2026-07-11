#!/usr/bin/env bash
set -e

echo "**** install gh, gcloud, mongosh ****"
mkdir -p -m 755 /etc/apt/keyrings

# GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null

# Google Cloud SDK
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
  | gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg
echo "deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
  | tee /etc/apt/sources.list.d/google-cloud-sdk.list > /dev/null

# MongoDB Shell (Debian bookworm repo)
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
  | gpg --dearmor -o /etc/apt/keyrings/mongodb-server-8.0.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/8.0 main" \
  | tee /etc/apt/sources.list.d/mongodb-org-8.0.list > /dev/null

apt-get update
apt-get install -y gh google-cloud-cli mongodb-mongosh || true
rm -rf /var/lib/apt/lists/* /var/tmp/*
