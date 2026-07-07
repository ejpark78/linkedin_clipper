# ==========================================
# 🤖 Agent Development Openbox - .zshrc
# ==========================================

# oh-my-zsh 경로 설정
export ZSH="$HOME/.oh-my-zsh"

# 테마 및 플러그인 정의
ZSH_THEME="robbyrussell"
plugins=(git docker docker-compose jq)

source $ZSH/oh-my-zsh.sh 2>/dev/null || true

# User Aliases
alias oc="opencode --auto"
alias dc="docker compose"
alias ll="ls -alF"
alias la="ls -A"
alias l="ls -CF"

# 기본 언어셋 및 PATH 설정
export LANG=ko_KR.UTF-8
export LC_ALL=ko_KR.UTF-8
export PATH="/opt/node24/bin:$PATH:$HOME/.local/bin"
