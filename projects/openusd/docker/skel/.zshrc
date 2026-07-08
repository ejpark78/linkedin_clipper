export ZSH="$HOME/.oh-my-zsh"

ZSH_THEME="robbyrussell"
plugins=(git docker docker-compose)

source $ZSH/oh-my-zsh.sh 2>/dev/null || true

alias dc="docker compose"
alias ll="ls -alF"
alias la="ls -A"
alias l="ls -CF"

export LANG=ko_KR.UTF-8
export LC_ALL=ko_KR.UTF-8
export PATH="/opt/node24/bin:$PATH:$HOME/.local/bin"
