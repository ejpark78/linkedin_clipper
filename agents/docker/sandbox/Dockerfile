FROM node:24-bookworm AS node_base

FROM ubuntu:26.04

ARG USER_UID=1000
ARG USER_GID=1000

# 필수 패키지 설치
RUN apt-get update && apt-get install -y \
    sudo \
    dumb-init \
    locales \
    git \
    make \
    curl \
    zsh \
    tmux \
    docker.io \
    docker-compose-v2 \
    jq \
    fontconfig \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# ubuntu 디폴트 유저의 UID를 호스트에 맞게 변경 (GID는 컨테이너 그룹과 충돌 방지)
RUN if [ "${USER_UID}" != "1000" ]; then \
      usermod -u ${USER_UID} ubuntu; \
    fi

# Node 24 LTS 멀티 스테이지 복사 (code-server Extension Host와 충돌 없음)
COPY --from=node_base /usr/local/bin/node /usr/local/bin/node
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# code-server 수동 설치
RUN curl -fsSL https://code-server.dev/install.sh | sh

# locales 파일 내 주석 제거 및 생성 강제화
RUN sed -i '/ko_KR.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen ko_KR.UTF-8

ENV LANG=ko_KR.UTF-8
ENV LANGUAGE=ko_KR.UTF-8
ENV LC_ALL=ko_KR.UTF-8

# uv 의존성 관리자 복사 이식 (멀티 스테이지 복사)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# go-task (task) 자동 설치 스크립트 실행
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

# opencode 설치 (/usr/local/bin에 바이너리 직접 배치)
RUN ARCH=$(dpkg --print-architecture | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$ARCH.tar.gz" | \
    tar -xz -C /usr/local/bin opencode

# GitHub CLI (gh) 공식 apt 저장소 등록 및 설치
RUN mkdir -p -m 755 /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && apt-get install -y gh

# Gitea CLI (tea) 설치 (아키텍처 맞춤 다운로드)
RUN ARCH=$(dpkg --print-architecture | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL -o /usr/local/bin/tea "https://dl.gitea.com/tea/0.9.2/tea-0.9.2-linux-$ARCH" && \
    chmod +x /usr/local/bin/tea

# mkcert 설치 (아키텍처 맞춤 다운로드)
RUN ARCH=$(dpkg --print-architecture | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    curl -fsSL -o /usr/local/bin/mkcert "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-$ARCH" && \
    chmod +x /usr/local/bin/mkcert

# oh-my-zsh 설치 스크립트 실행
USER ubuntu
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# JetBrainsMono Nerd Font 설치 및 code-server 폰트 설정
USER root
RUN mkdir -p /usr/local/share/fonts/jetbrains-mono && \
    curl -fsSL https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.tar.xz | \
    tar -xJ -C /usr/local/share/fonts/jetbrains-mono && \
    fc-cache -f && \
    mkdir -p /home/ubuntu/.code-server-data/User && \
    chown -R ubuntu:ubuntu /home/ubuntu/.code-server-data
USER ubuntu
RUN cat > /home/ubuntu/.code-server-data/User/settings.json << 'EOF'
{
    "terminal.integrated.fontFamily": "'JetBrainsMono Nerd Font'",
    "editor.fontFamily": "'JetBrainsMono Nerd Font'",
    "editor.fontLigatures": true,
    "editor.fontSize": 14,
    "terminal.integrated.fontSize": 14
}
EOF

# Google Antigravity CLI (agy) 및 OpenAI Codex CLI 설치 (root 권한 필요)
USER root
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin && \
    npm install -g @openai/codex

# coder 사용자의 zshrc에 oc alias 추가
USER ubuntu
RUN echo 'alias oc="opencode --auto"' >> $HOME/.zshrc

# 기본 shell을 zsh로 강제 지정
ENV SHELL=/bin/zsh

USER root
RUN chsh -s /bin/zsh ubuntu

USER ubuntu

ENTRYPOINT ["dumb-init", "code-server"]

# 헬스체크 설정 (포트 8080에 curl HTTP 요청 전송)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1
