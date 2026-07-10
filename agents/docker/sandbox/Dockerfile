# syntax=docker/dockerfile:1
FROM node:24-bookworm AS node_base

FROM ubuntu:26.04

ARG USER_UID=1000
ARG USER_GID=1000

# 필수 패키지 설치
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/01-system-packages.sh

# locales 파일 내 주석 제거 및 생성 강제화
RUN sed -i '/ko_KR.UTF-8/s/^# //g' /etc/locale.gen && \
  locale-gen ko_KR.UTF-8

ENV LANG=ko_KR.UTF-8
ENV LANGUAGE=ko_KR.UTF-8
ENV LC_ALL=ko_KR.UTF-8

# ubuntu 사용자의 패스워드 없는 sudo 권한 설정
RUN echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-ubuntu

# ubuntu 디폴트 유저의 UID를 호스트에 맞게 변경 (GID는 컨테이너 그룹과 충돌 방지)
RUN if [ "${USER_UID}" != "1000" ]; then \
  usermod -u ${USER_UID} ubuntu; \
  fi

# Node 24 LTS 멀티 스테이지 복사 (code-server Extension Host와 충돌 없음)
COPY --from=node_base /usr/local/bin/node /usr/local/bin/node
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
  ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# uv 의존성 관리자 복사 이식 (멀티 스테이지 복사)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# ============================================================
# 🔑 Root 권한 유틸리티 설치 (setup.d/root 위임)
# ============================================================
USER root

# 1. code-server 수동 설치
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/02-code-server.sh

# 2. go-task 설치
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/03-go-task.sh

# 3. opencode 설치 (캐시 마운트 추가)
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    bash /tmp/setup.d/root/04-opencode.sh

# 4. GitHub CLI, Google Cloud SDK, MongoDB Shell 설치
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/05-github-cli.sh

# 5. Gitea CLI (tea) 설치 (캐시 마운트 추가)
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    bash /tmp/setup.d/root/06-gitea-tea.sh

# 6. Jira CLI 설치 (캐시 마운트 추가)
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    bash /tmp/setup.d/root/07-jira-cli.sh

# 7. JetBrainsMono Nerd Font 설치 (캐시 마운트 추가)
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    bash /tmp/setup.d/root/08-fonts.sh

# 8. Google Antigravity CLI, OpenAI Codex CLI, Joplin CLI 설치
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/root/09-google-agy-codex.sh


# ============================================================
# 👤 User(ubuntu) 권한 유틸리티 설치 (setup.d/user 위임)
# ============================================================
USER ubuntu

# 1. oh-my-zsh 설치
RUN --mount=type=bind,source=./setup.d,target=/tmp/setup.d \
    bash /tmp/setup.d/user/01-oh-my-zsh.sh

# 뼈대(skel) 설정 파일 복사 및 ubuntu 사용자 홈에 반영 (oh-my-zsh 기본 .zshrc를 skel 설정으로 덮어씀)
USER root
COPY skel/ /etc/skel/
RUN cp -rT /etc/skel/ /home/ubuntu/ && \
  chown -R ubuntu:ubuntu /home/ubuntu

# init-scripts 및 entrypoint 설치
COPY init-scripts/ /etc/init-scripts/
RUN chmod +x /etc/init-scripts/*
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

# 기본 shell을 zsh로 강제 지정
ENV SHELL=/bin/zsh
RUN chsh -s /bin/zsh ubuntu

USER ubuntu

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# 헬스체크 설정 (포트 8080에 curl HTTP 요청 전송)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1
