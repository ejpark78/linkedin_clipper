FROM codercom/code-server:latest

USER root

# 필수 패키지, zsh, locales 설치
RUN apt-get update && apt-get install -y \
    locales \
    git \
    make \
    curl \
    zsh \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# locales 파일 내 주석 제거 및 생성 강제화
RUN sed -i '/ko_KR.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen ko_KR.UTF-8

ENV LANG=ko_KR.UTF-8
ENV LANGUAGE=ko_KR.UTF-8
ENV LC_ALL=ko_KR.UTF-8

# 전역 Node.js 패키지 설치
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest

# opencode-ai, @openai/codex CLI 설치
RUN npm install -g opencode-ai @openai/codex

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
