# syntax=docker/dockerfile:1
FROM node:24-bookworm AS node_base

FROM ubuntu:26.04

ARG USER_UID=1000
ARG USER_GID=1000

RUN apt-get update && apt-get install -y \
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
    gnupg \
    && rm -rf /var/lib/apt/lists/*

RUN echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-ubuntu

RUN if [ "${USER_UID}" != "1000" ]; then \
      usermod -u ${USER_UID} ubuntu; \
    fi

COPY --from=node_base /usr/local/bin/node /usr/local/bin/node
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN curl -fsSL https://code-server.dev/install.sh | sh

RUN sed -i '/ko_KR.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen ko_KR.UTF-8

ENV LANG=ko_KR.UTF-8
ENV LANGUAGE=ko_KR.UTF-8
ENV LC_ALL=ko_KR.UTF-8

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

RUN --mount=type=bind,source=./docker/.cache,target=/opt/cache,readonly \
    ARCH_DIR=$(dpkg --print-architecture) && \
    ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/; s/x86_64/x64/; s/aarch64/arm64/') && \
    if [ -s "/opt/cache/$ARCH_DIR/opencode-linux-$ARCH.tar.gz" ]; then \
        tar -xz -C /usr/local/bin opencode < "/opt/cache/$ARCH_DIR/opencode-linux-$ARCH.tar.gz"; \
    else \
        curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$ARCH.tar.gz" | \
        tar -xz -C /usr/local/bin opencode; \
    fi

USER ubuntu
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

USER root
COPY docker/skel/ /etc/skel/
RUN cp -rT /etc/skel/ /home/ubuntu/ && \
    chown -R ubuntu:ubuntu /home/ubuntu

USER root
RUN --mount=type=bind,source=./docker/.cache,target=/opt/cache,readonly \
    ARCH_DIR=$(dpkg --print-architecture) && \
    mkdir -p /usr/local/share/fonts/jetbrains-mono && \
    if [ -s "/opt/cache/$ARCH_DIR/JetBrainsMono.tar.xz" ]; then \
        tar -xJ -C /usr/local/share/fonts/jetbrains-mono < "/opt/cache/$ARCH_DIR/JetBrainsMono.tar.xz"; \
    else \
        curl -fsSL https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.tar.xz | \
        tar -xJ -C /usr/local/share/fonts/jetbrains-mono; \
    fi && \
    fc-cache -f

USER root
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin && \
    npm install -g @openai/codex

COPY docker/init-scripts/ /etc/init-scripts/
RUN chmod +x /etc/init-scripts/*

ENV SHELL=/bin/zsh
RUN chsh -s /bin/zsh ubuntu

USER root
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git-lfs \
    && rm -rf /var/lib/apt/lists/*

ENV UV_PROJECT_ENVIRONMENT=/opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN uv python install 3.12
COPY LearnOpenUSD/pyproject.toml LearnOpenUSD/requirements.txt ./
RUN uv venv --python 3.12 /opt/venv && uv pip install -r requirements.txt

COPY LearnOpenUSD/ .
RUN uv pip install -e .

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY docker/jupyter.sh /home/ubuntu/jupyter.sh
RUN chmod +x /home/ubuntu/jupyter.sh && chown ubuntu:ubuntu /home/ubuntu/jupyter.sh

EXPOSE 8080

RUN chown -R ubuntu:ubuntu /opt/venv

USER ubuntu
ENTRYPOINT ["/entrypoint.sh"]
