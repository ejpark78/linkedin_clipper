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

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/06-go-task.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/07-nodejs.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    bash /tmp/setup.d/root/08-opencode.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/09-github-cli.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    bash /tmp/setup.d/root/10-gitea-tea.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    bash /tmp/setup.d/root/11-jira-cli.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/12-google-agy-codex.sh

RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    chmod 777 /config && \
    s6-setuidgid abc bash /tmp/setup.d/user/01-oh-my-zsh.sh && \
    chmod 755 /config

COPY /root /

EXPOSE 3001
VOLUME /config
