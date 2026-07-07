# ==========================================
# 🤖 Agent Development Sandbox - .zshrc
# ==========================================

# oh-my-zsh 경로 설정
export ZSH="$HOME/.oh-my-zsh"

# 테마 및 플러그인 정의
ZSH_THEME="robbyrussell"
plugins=(git docker docker-compose)

source $ZSH/oh-my-zsh.sh

# User Aliases
alias oc="opencode --auto"
alias dc="docker compose"

alias ll="ls -alF"
alias la="ls -A"
alias l="ls -CF"

# 기본 언어셋 설정
export LANG=ko_KR.UTF-8
export LC_ALL=ko_KR.UTF-8
