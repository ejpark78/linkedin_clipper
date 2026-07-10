# syntax=docker/dockerfile:1
FROM kasmweb/core-ubuntu-noble:1.18.0
USER root

ENV HOME /home/kasm-default-profile
ENV STARTUPDIR /dockerstartup
ENV INST_SCRIPTS $STARTUPDIR/install
WORKDIR $HOME

# 기본 패키지
RUN apt-get update && apt-get install -y sudo curl wget tmux unzip xz-utils fonts-nanum fcitx fcitx-hangul && rm -rf /var/lib/apt/lists/*

ENV GTK_IM_MODULE=fcitx
ENV QT_IM_MODULE=fcitx
ENV XMODIFIERS=@im=fcitx

# Brave 설치 (Kasm 공식 방식)
RUN curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" > /etc/apt/sources.list.d/brave-browser-release.list && \
  apt-get update && apt-get install -y brave-browser && \
  sed -i 's/-stable//g' /usr/share/applications/brave-browser.desktop && \
  mv /usr/bin/brave-browser /usr/bin/brave-browser-orig && \
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'CHROME_ARGS="--password-store=basic --no-sandbox --ignore-gpu-blocklist --user-data-dir --no-first-run --check-for-update-interval=31449600"' \
    'sed -i '\''s/"exited_cleanly":false/"exited_cleanly":true/'\'' ~/.config/BraveSoftware/Brave-Browser/Default/Preferences 2>/dev/null' \
    'sed -i '\''s/"exit_type":"Crashed"/"exit_type":"None"/'\'' ~/.config/BraveSoftware/Brave-Browser/Default/Preferences 2>/dev/null' \
    'exec /opt/brave.com/brave/brave-browser ${CHROME_ARGS} "$@"' \
    > /usr/bin/brave-browser && \
  chmod +x /usr/bin/brave-browser

# VSCode 설치 (Kasm 공식 방식)
RUN ARCH=$(dpkg --print-architecture | sed 's/arm64/arm64/g' | sed 's/amd64/x64/g') && \
  curl -fsSL -o /tmp/vs_code.deb "https://update.code.visualstudio.com/latest/linux-deb-${ARCH}/stable" && \
  apt-get update && apt-get install -y /tmp/vs_code.deb && \
  rm -f /tmp/vs_code.deb && \
  sed -i 's#/usr/share/code/code#/usr/share/code/code --no-sandbox#g' /usr/share/applications/code.desktop

# opencode CLI 설치
RUN --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    ARCH_DIR=$(dpkg --print-architecture) && \
    ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/' | sed 's/aarch64/arm64/') && \
    if [ -s "/opt/cache/$ARCH_DIR/opencode-linux-$ARCH.tar.gz" ]; then \
        echo ">>> CACHE HIT"; \
        tar -xz -C /usr/local/bin opencode < "/opt/cache/$ARCH_DIR/opencode-linux-$ARCH.tar.gz"; \
    else \
        echo ">>> CACHE MISS"; \
        curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$ARCH.tar.gz" | \
        tar -xz -C /usr/local/bin opencode; \
    fi

# opencode Desktop 설치
RUN --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    ARCH_DIR=$(dpkg --print-architecture) && \
    ARCH=$(dpkg --print-architecture | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    if [ -s "/opt/cache/$ARCH_DIR/opencode-desktop-linux-$ARCH.deb" ]; then \
        cp "/opt/cache/$ARCH_DIR/opencode-desktop-linux-$ARCH.deb" /tmp/opencode.deb; \
    else \
        curl -fsSL -o /tmp/opencode.deb "https://github.com/anomalyco/opencode/releases/latest/download/opencode-desktop-linux-$ARCH.deb"; \
    fi && \
  apt-get update && apt-get install -y /tmp/opencode.deb && \
  rm -f /tmp/opencode.deb && rm -rf /var/lib/apt/lists/*

# JetBrainsMono Nerd Font 설치
RUN --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    ARCH_DIR=$(dpkg --print-architecture) && \
    if [ -s "/opt/cache/$ARCH_DIR/JetBrainsMono.tar.xz" ]; then \
        mkdir -p /usr/local/share/fonts/jetbrains-mono && \
        tar -xJf "/opt/cache/$ARCH_DIR/JetBrainsMono.tar.xz" -C /usr/local/share/fonts/jetbrains-mono && \
        fc-cache -f; \
    fi

# opencode Desktop settings
RUN mkdir -p /home/kasm-default-profile/.config/opencode && \
  echo '{"useNewLayout":true}' > /home/kasm-default-profile/.config/opencode/settings.json

# opencode desktop .desktop 파일에 --no-sandbox 추가
RUN sed -i 's#Exec=/opt/OpenCode/ai.opencode.desktop#Exec=/opt/OpenCode/ai.opencode.desktop --no-sandbox#' /usr/share/applications/ai.opencode.desktop.desktop 2>/dev/null || true

# VSCode settings (초기 설정)
RUN mkdir -p /home/kasm-default-profile/.config/Code/User && \
  python3 -c 'import json; json.dump({"editor.fontFamily": "\u0027JetBrainsMono Nerd Font\u0027, \u0027Noto Sans CJK KR\u0027", "editor.fontSize": 14, "editor.fontLigatures": True, "terminal.integrated.fontFamily": "\u0027JetBrainsMono Nerd Font\u0027, \u0027Noto Sans CJK KR\u0027", "terminal.integrated.fontSize": 14, "terminal.integrated.gpuAcceleration": "off", "workbench.sideBar.location": "right"}, open("/home/kasm-default-profile/.config/Code/User/settings.json", "w"), indent=4)'



# fcitx 자동 시작 + 한글 기본 입력기 + kasmvnc IME 설정
RUN mkdir -p /home/kasm-default-profile/.vnc /home/kasm-default-profile/.config/autostart /home/kasm-default-profile/.config/fcitx && \
  printf '%s\n' \
    '[Desktop Entry]' \
    'Type=Application' \
    'Name=fcitx' \
    'Exec=sh -c "sleep 2 && fcitx -d"' \
    'StartupNotify=false' \
    > /home/kasm-default-profile/.config/autostart/fcitx.desktop && \
  printf '%s\n' \
    '[Profile]' \
    'TriggerHotkey=CTRL_SPACE' \
    'EnabledIMList=fcitx-keyboard-kr:True,hangul:True,default:True' \
    > /home/kasm-default-profile/.config/fcitx/profile && \
  printf '%s\n' \
    'keyboard:' \
    '  raw_keyboard: false' \
    'logging:' \
    '  log_writer_name: all' \
    '  log_dest: logfile' \
    '  level: 100' \
    > /home/kasm-default-profile/.vnc/kasmvnc.yaml

# sudo 권한
RUN echo "kasm-user ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Kasm 사용자 설정
RUN $STARTUPDIR/set_user_permission.sh $HOME

ENV HOME /home/kasm-user
WORKDIR $HOME
RUN mkdir -p $HOME && chown -R 1000:0 $HOME

# 사용자 홈 디렉토리 초기화
RUN mkdir -p /home/kasm-user && chown -R 1000:0 /home/kasm-user/

USER 1000
