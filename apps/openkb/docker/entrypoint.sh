#!/bin/sh
set -e

# output-base 사용 시 (SKIP_OPENKB_CONFIG=1) 기본 config 생략
if [ "$SKIP_OPENKB_CONFIG" != "1" ]; then
    mkdir -p /data/openkb/.config/openkb
    mkdir -p /data/openkb/.openkb
    cp /app/docker/global.yaml /data/openkb/.config/openkb/global.yaml
    cp /app/docker/config.yaml /data/openkb/.openkb/config.yaml
fi

exec "$@"
