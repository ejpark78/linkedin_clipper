FROM ghcr.io/linuxserver/baseimage-selkies:debiantrixie

RUN apt-get update && apt-get install -y tmux wtype && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://brave-browser-apt-release.s3.brave.com/brave-core.asc \
    | gpg --dearmor -o /etc/apt/keyrings/brave-browser.gpg && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/brave-browser.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" \
    | tee /etc/apt/sources.list.d/brave-browser.list > /dev/null && \
  apt-get update && apt-get install -y brave-browser && \
  rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor -o /etc/apt/keyrings/packages.microsoft.gpg && \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" \
    | tee /etc/apt/sources.list.d/vscode.list > /dev/null && \
  apt-get update && apt-get install -y code && \
  rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') && \
  curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$ARCH.tar.gz" \
    | tar -xz -C /usr/local/bin opencode

RUN ARCH=$(dpkg --print-architecture | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
  curl -fsSL -o /tmp/opencode.deb "https://github.com/anomalyco/opencode/releases/latest/download/opencode-desktop-linux-$ARCH.deb" && \
  apt-get update && apt-get install -y /tmp/opencode.deb && \
  rm -f /tmp/opencode.deb && rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/' | sed 's/arm64/arm64/') && \
  curl -fsSL -o /tmp/cursor.deb \
    "https://api2.cursor.sh/updates/download/golden/linux-${ARCH}-deb/cursor/latest" && \
  apt-get update && apt-get install -y /tmp/cursor.deb && \
  rm -f /tmp/cursor.deb && rm -rf /var/lib/apt/lists/*

RUN if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
  curl -fsSL -o /tmp/devin.deb \
    "https://windsurf-stable.codeiumdata.com/linux-x64-deb/stable/0d4bf12ed4a7597cb8ae9016fe8474468aad98a2/Devin-linux-x64-3.4.27.deb" && \
  apt-get update && apt-get install -y /tmp/devin.deb && \
  rm -f /tmp/devin.deb && rm -rf /var/lib/apt/lists/*; \
  fi

RUN ARCH_DIR=$(dpkg --print-architecture | sed 's/amd64/linux-x64/' | sed 's/arm64/linux-arm/') && \
  curl -fsSL -o /tmp/Antigravity.tar.gz \
    "https://storage.googleapis.com/antigravity-public/antigravity-hub/2.2.1-5287492581195776/${ARCH_DIR}/Antigravity.tar.gz" && \
  tar -xzf /tmp/Antigravity.tar.gz -C /opt && \
  rm -f /tmp/Antigravity.tar.gz

RUN if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
  curl -fsSL -o /tmp/kiro.deb \
    "https://prod.download.desktop.kiro.dev/releases/stable/linux-x64/signed/1.0.89/deb/kiro-ide-1.0.89-stable-linux-x64.deb" && \
  apt-get update && apt-get install -y /tmp/kiro.deb && \
  rm -f /tmp/kiro.deb && rm -rf /var/lib/apt/lists/*; \
  fi

RUN curl -fsSL https://cli.kiro.dev/install | bash

RUN mkdir -p /config/.config/opencode && \
  echo '{"useNewLayout":true}' > /config/.config/opencode/settings.json

RUN mkdir -p /etc/cont-init.d && \
  echo '#!/usr/bin/with-contenv bash' > /etc/cont-init.d/41-disable-capslock && \
  echo 'AUTOSTART="/config/.config/labwc/autostart"' >> /etc/cont-init.d/41-disable-capslock && \
  echo 'mkdir -p "$(dirname "$AUTOSTART")"' >> /etc/cont-init.d/41-disable-capslock && \
  echo 'touch "$AUTOSTART"' >> /etc/cont-init.d/41-disable-capslock && \
  echo 'if ! grep -q "wtype.*Caps_Lock" "$AUTOSTART" 2>/dev/null; then' >> /etc/cont-init.d/41-disable-capslock && \
  echo '  echo "sleep 3" >> "$AUTOSTART"' >> /etc/cont-init.d/41-disable-capslock && \
  echo '  echo "wtype -k Caps_Lock 2>/dev/null || true" >> "$AUTOSTART"' >> /etc/cont-init.d/41-disable-capslock && \
  echo 'fi' >> /etc/cont-init.d/41-disable-capslock && \
  chmod +x /etc/cont-init.d/41-disable-capslock
