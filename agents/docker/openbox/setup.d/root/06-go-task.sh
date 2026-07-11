#!/usr/bin/env bash
set -e

echo "**** install go-task ****"
sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
