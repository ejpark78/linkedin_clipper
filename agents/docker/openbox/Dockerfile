# syntax=docker/dockerfile:1
FROM ghcr.io/linuxserver/baseimage-selkies:debiantrixie

ENV TITLE="OpenBox" \
    NO_GAMEPAD=true \
    PIXELFLUX_WAYLAND=true

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/01-system-packages.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/02-code.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/03-brave.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/04-obsidian.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/05-fonts.sh

COPY /root /

EXPOSE 3001
VOLUME /config
