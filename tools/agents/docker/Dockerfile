FROM codercom/code-server:latest

USER root

# 한글 Locale 설정 및 깨짐 방지 패키지 설치
RUN apt-get update && apt-get install -y \
    locales \
    git \
    make \
    curl \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# locales 파일 내 주석 제거 및 생성 강제화
RUN sed -i '/ko_KR.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen ko_KR.UTF-8

ENV LANG=ko_KR.UTF-8
ENV LANGUAGE=ko_KR.UTF-8
ENV LC_ALL=ko_KR.UTF-8

# 작업 권한 매핑을 위해 기본 실행 그룹을 root/docker로 셋업
USER coder
