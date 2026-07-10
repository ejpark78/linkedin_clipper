# syntax=docker/dockerfile:1
FROM ghcr.io/linuxserver/baseimage-selkies:debiantrixie

RUN apt-get update && apt-get install -y tmux wtype unzip && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://brave-browser-apt-release.s3.brave.com/brave-core.asc | \
    gpg --dearmor -o /etc/apt/keyrings/brave-browser.gpg && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/brave-browser.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" \
    | tee /etc/apt/sources.list.d/brave-browser.list > /dev/null && \
  apt-get update && apt-get install -y brave-browser && \
  rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | \
    gpg --dearmor -o /etc/apt/keyrings/packages.microsoft.gpg && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" \
    | tee /etc/apt/sources.list.d/vscode.list > /dev/null && \
  apt-get update && apt-get install -y code && \
  rm -rf /var/lib/apt/lists/*

RUN --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    ARCH_DIR=$(dpkg --print-architecture) && \
    ARCH=$(dpkg --print-architecture | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') && \
    if [ -s "/opt/cache/$ARCH_DIR/opencode-linux-$ARCH.tar.gz" ]; then \
        echo ">>> CACHE HIT"; \
        tar -xz -C /usr/local/bin opencode < "/opt/cache/$ARCH_DIR/opencode-linux-$ARCH.tar.gz"; \
    else \
        echo ">>> CACHE MISS"; \
        curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$ARCH.tar.gz" | \
        tar -xz -C /usr/local/bin opencode; \
    fi

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

RUN --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    ARCH_DIR=$(dpkg --print-architecture) && \
    ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/' | sed 's/arm64/arm64/') && \
    if [ -s "/opt/cache/$ARCH_DIR/cursor-linux-${ARCH}.deb" ]; then \
        cp "/opt/cache/$ARCH_DIR/cursor-linux-${ARCH}.deb" /tmp/cursor.deb; \
    else \
        curl -fsSL -o /tmp/cursor.deb \
            "https://api2.cursor.sh/updates/download/golden/linux-${ARCH}-deb/cursor/latest"; \
    fi && \
  apt-get update && apt-get install -y /tmp/cursor.deb && \
  rm -f /tmp/cursor.deb && rm -rf /var/lib/apt/lists/*

RUN --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
        ARCH_DIR=$(dpkg --print-architecture) && \
        if [ -s "/opt/cache/$ARCH_DIR/devin.deb" ]; then \
            cp "/opt/cache/$ARCH_DIR/devin.deb" /tmp/devin.deb; \
        else \
            curl -fsSL -o /tmp/devin.deb \
                "https://windsurf-stable.codeiumdata.com/linux-x64-deb/stable/0d4bf12ed4a7597cb8ae9016fe8474468aad98a2/Devin-linux-x64-3.4.27.deb"; \
        fi && \
        apt-get update && apt-get install -y /tmp/devin.deb && \
        rm -f /tmp/devin.deb && rm -rf /var/lib/apt/lists/*; \
    fi

RUN --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    ARCH_DIR=$(dpkg --print-architecture) && \
    URL_ARCH=$(dpkg --print-architecture | sed 's/amd64/linux-x64/' | sed 's/arm64/linux-arm/') && \
    if [ -s "/opt/cache/$ARCH_DIR/antigravity-$URL_ARCH.tar.gz" ]; then \
        tar -xzf "/opt/cache/$ARCH_DIR/antigravity-$URL_ARCH.tar.gz" -C /opt; \
    else \
        curl -fsSL -o /tmp/Antigravity.tar.gz \
            "https://storage.googleapis.com/antigravity-public/antigravity-hub/2.2.1-5287492581195776/${URL_ARCH}/Antigravity.tar.gz" && \
        tar -xzf /tmp/Antigravity.tar.gz -C /opt && \
        rm -f /tmp/Antigravity.tar.gz; \
    fi

RUN --mount=type=bind,source=./.cache,target=/opt/cache,readonly \
    if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
        ARCH_DIR=$(dpkg --print-architecture) && \
        if [ -s "/opt/cache/$ARCH_DIR/kiro.deb" ]; then \
            cp "/opt/cache/$ARCH_DIR/kiro.deb" /tmp/kiro.deb; \
        else \
            curl -fsSL -o /tmp/kiro.deb \
                "https://prod.download.desktop.kiro.dev/releases/stable/linux-x64/signed/1.0.89/deb/kiro-ide-1.0.89-stable-linux-x64.deb"; \
        fi && \
        apt-get update && apt-get install -y /tmp/kiro.deb && \
        rm -f /tmp/kiro.deb && rm -rf /var/lib/apt/lists/*; \
    fi

RUN curl -fsSL https://cli.kiro.dev/install | bash || true

RUN mkdir -p /config/.config/opencode && \
  echo '{"useNewLayout":true}' > /config/.config/opencode/settings.json

RUN mkdir -p /etc/cont-init.d && \
  printf '%s\n' \
    '#!/usr/bin/with-contenv bash' \
    'chown -R abc:abc "${PROJECT_PATH:-.}/node_modules" "${PROJECT_PATH:-.}/.venv" 2>/dev/null' \
    'cd "${PROJECT_PATH:-.}"' \
    '[ -f package.json ] && npm install --no-audit --no-fund' \
    '[ -f pyproject.toml ] || [ -f requirements.txt ] && uv sync 2>/dev/null || true' \
    > /etc/cont-init.d/00-fix-perms && \
  chmod +x /etc/cont-init.d/00-fix-perms && \
  printf '%s\n' \
    '#!/usr/bin/with-contenv bash' \
    'AUTOSTART="/config/.config/labwc/autostart"' \
    'mkdir -p "$(dirname "$AUTOSTART")"' \
    'touch "$AUTOSTART"' \
    'if ! grep -q "wtype.*Caps_Lock" "$AUTOSTART" 2>/dev/null; then' \
    '  echo "sleep 3" >> "$AUTOSTART"' \
    '  echo "wtype -k Caps_Lock 2>/dev/null || true" >> "$AUTOSTART"' \
    'fi' \
    > /etc/cont-init.d/41-disable-capslock && \
  chmod +x /etc/cont-init.d/41-disable-capslock
