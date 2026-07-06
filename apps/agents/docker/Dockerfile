FROM node:24 AS node_base

FROM codercom/code-server:ubuntu

USER root

# 필수 패키지, zsh, locales, sudo, jq 설치
RUN apt-get update && apt-get install -y \
    locales \
    git \
    make \
    curl \
    zsh \
    docker.io \
    docker-compose-v2 \
    sudo \
    jq \
    && rm -rf /var/lib/apt/lists/*

# coder 유저 비밀번호 없는 sudo 권한 설정
RUN echo "coder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/nopasswd

# locales 파일 내 주석 제거 및 생성 강제화
RUN sed -i '/ko_KR.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen ko_KR.UTF-8

ENV LANG=ko_KR.UTF-8
ENV LANGUAGE=ko_KR.UTF-8
ENV LC_ALL=ko_KR.UTF-8

# 전역 Node.js v24 복사 설치 (멀티 스테이지 빌드 방식)
COPY --from=node_base /usr/local/bin/node /usr/local/bin/node
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

# uv 의존성 관리자 복사 이식 (멀티 스테이지 복사)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# go-task (task) 자동 설치 스크립트 실행
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

# opencode-ai 플랫폼 에러 우회(glibc 지원되는 linux-arm64 바이너리 수동 매핑 지시)
# Codex 및 OpenCode 패키지 설치 (강제 플래그 및 플랫폼 우회 명시)
RUN npm install -g --unsafe-perm --force opencode-ai @openai/codex || \
    npm install -g --unsafe-perm --force opencode-linux-arm64 @openai/codex

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

# oh-my-zsh 설치 스크립트 실행 (사용자 coder 환경 대상)
USER coder
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# Google Antigravity CLI (agy) 설치 (사용자 coder 환경의 로컬 경로에 설치)
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

# coder 사용자의 zshrc에 agy 실행 PATH 강제 추가
RUN echo 'export PATH=$HOME/.local/bin:$PATH' >> $HOME/.zshrc

# 기본 shell을 zsh로 강제 지정
ENV SHELL=/bin/zsh

USER root
RUN chsh -s /bin/zsh coder

USER coder

# 헬스체크 설정 (포트 8080에 curl HTTP 요청 전송)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1
