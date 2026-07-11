#!/usr/bin/env bash
set -e

echo "**** install jira-cli ****"
ARCH_DIR=$(dpkg --print-architecture)
ARCH=$(dpkg --print-architecture | sed 's/amd64/x86_64/' | sed 's/arm64/arm64/')

if [ -s "/opt/cache/$ARCH_DIR/jira-linux-$ARCH.tar.gz" ]; then
  tar -xzf "/opt/cache/$ARCH_DIR/jira-linux-$ARCH.tar.gz" -C /tmp
else
  VERSION=$(curl -fsSL https://api.github.com/repos/ankitpokhrel/jira-cli/releases/latest \
    | jq -r .tag_name | sed 's/v//')
  curl -fsSL -o /tmp/jira.tar.gz \
    "https://github.com/ankitpokhrel/jira-cli/releases/download/v${VERSION}/jira_${VERSION}_linux_${ARCH}.tar.gz"
  tar -xzf /tmp/jira.tar.gz -C /tmp
  rm -f /tmp/jira.tar.gz
fi

DIR=$(ls /tmp | grep jira)
mv "/tmp/$DIR/bin/jira" /usr/local/bin/jira
rm -rf "/tmp/$DIR"
