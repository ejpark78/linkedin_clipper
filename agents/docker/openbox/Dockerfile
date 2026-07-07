FROM node:24-bookworm AS node_base

FROM lscr.io/linuxserver/webtop:ubuntu-openbox

# 한글 입력기(IME) 환경 변수 설정
ENV GTK_IM_MODULE=fcitx
ENV QT_IM_MODULE=fcitx
ENV XMODIFIERS=@im=fcitx

# OS 패키지 의존성 설치
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
    jq \
    fontconfig \
    xz-utils \
    redis-tools \
    gnupg \
    fcitx \
    fcitx-hangul \
    dbus-x11 \
    fonts-nanum \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI 및 Docker Compose 플러그인 직접 설치 (apt containerd/compose 충돌 방지)
RUN ARCH=$(dpkg --print-architecture | sed 's/amd64/x86_64/' | sed 's/arm64/aarch64/') && \
    curl -fsSL "https://download.docker.com/linux/static/stable/${ARCH}/docker-26.1.4.tgz" | \
    tar -xz -C /tmp && \
    mv /tmp/docker/docker /usr/local/bin/docker && \
    rm -rf /tmp/docker && \
    mkdir -p /usr/local/lib/docker/cli-plugins && \
    curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
    "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" && \
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose && \
    ln -s /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose

# Node 24 LTS 복사 이식 (Webtop 내부 kclient node 버전 충돌 방지를 위해 /opt/node24 격리)
COPY --from=node_base /usr/local/bin/node /opt/node24/bin/node
COPY --from=node_base /usr/local/lib/node_modules /opt/node24/lib/node_modules
RUN ln -s /opt/node24/lib/node_modules/npm/bin/npm-cli.js /opt/node24/bin/npm && \
    ln -s /opt/node24/lib/node_modules/npm/bin/npx-cli.js /opt/node24/bin/npx

# uv 의존성 관리자 복사 이식 (멀티 스테이지 복사)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# go-task (task) 자동 설치
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

# GitHub CLI (gh), Google Cloud SDK (gcloud), MongoDB Shell (mongosh) 공식 apt 저장소 등록 및 설치
RUN mkdir -p -m 755 /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee /etc/apt/sources.list.d/google-cloud-sdk.list > /dev/null && \
    curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /etc/apt/keyrings/mongodb-server-8.0.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-8.0.list > /dev/null && \
    apt-get update && apt-get install -y gh google-cloud-cli mongodb-mongosh

# Gitea CLI (tea) 설치 (아키텍처 맞춤 다운로드)
RUN ARCH=$(dpkg --print-architecture | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL -o /usr/local/bin/tea "https://dl.gitea.com/tea/0.9.2/tea-0.9.2-linux-$ARCH" && \
    chmod +x /usr/local/bin/tea

# Jira CLI 설치 (GitHub Releases에서 다운로드)
RUN ARCH=$(dpkg --print-architecture | sed 's/amd64/x86_64/' | sed 's/arm64/arm64/') && \
    VERSION=$(curl -fsSL https://api.github.com/repos/ankitpokhrel/jira-cli/releases/latest | jq -r .tag_name | sed 's/v//') && \
    curl -fsSL -o /tmp/jira.tar.gz "https://github.com/ankitpokhrel/jira-cli/releases/download/v${VERSION}/jira_${VERSION}_linux_${ARCH}.tar.gz" && \
    tar -xzf /tmp/jira.tar.gz -C /tmp && \
    mv /tmp/jira_${VERSION}_linux_${ARCH}/bin/jira /usr/local/bin/jira && \
    rm -rf /tmp/jira.tar.gz /tmp/jira_${VERSION}_linux_${ARCH}

# OpenCode CLI 설치
RUN ARCH=$(dpkg --print-architecture | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$ARCH.tar.gz" | \
    tar -xz -C /usr/local/bin opencode

# OpenCode Desktop (GUI) 설치 (.deb 패키지 다운로드 및 의존성 설치)
RUN ARCH=$(dpkg --print-architecture | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL -o /tmp/opencode.deb "https://github.com/anomalyco/opencode/releases/latest/download/opencode-desktop-linux-$ARCH.deb" && \
    apt-get update && apt-get install -y /tmp/opencode.deb && \
    rm -f /tmp/opencode.deb

# mkcert 설치 (아키텍처 맞춤 다운로드)
RUN ARCH=$(dpkg --print-architecture | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL -o /usr/local/bin/mkcert "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-$ARCH" && \
    chmod +x /usr/local/bin/mkcert

# Google Antigravity CLI (agy), OpenAI Codex CLI, Joplin CLI 설치 (root 권한 필요)
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin && \
    /opt/node24/bin/npm install -g @openai/codex joplin

# JetBrainsMono Nerd Font 설치 및 캐시 갱신
RUN mkdir -p /usr/local/share/fonts/jetbrains-mono && \
    curl -fsSL https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.tar.xz | \
    tar -xJ -C /usr/local/share/fonts/jetbrains-mono && \
    fc-cache -f

# 뼈대(skel) 파일을 컨테이너 런타임 초기화 용도로 /opt/skel에 복사
COPY skel/ /opt/skel/

# Webtop의 초기화 라이프사이클(/etc/cont-init.d)을 활용한 사용자 설정 동적 주입
COPY init-scripts/ /etc/cont-init.d/
RUN chmod +x /etc/cont-init.d/*

# 기본 쉘 설정 및 권한 설정
ENV SHELL=/bin/zsh
RUN chsh -s /bin/zsh abc
