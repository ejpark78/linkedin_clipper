FROM ghcr.io/linuxserver/baseimage-selkies:debiantrixie

RUN apt-get update && apt-get install -y tmux && rm -rf /var/lib/apt/lists/*

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

RUN mkdir -p /config/.config/opencode && \
  echo '{"useNewLayout":true}' > /config/.config/opencode/settings.json
