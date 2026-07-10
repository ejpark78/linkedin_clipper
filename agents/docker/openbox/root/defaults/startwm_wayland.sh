#!/usr/bin/env bash

# Start DE
ulimit -c 0
export XCURSOR_THEME=breeze_cursors
export XCURSOR_SIZE=24
export XKB_DEFAULT_LAYOUT=us
export XKB_DEFAULT_RULES=evdev
export WAYLAND_DISPLAY=wayland-1

# labwc menu 강제 설정 (볼륨 persist 대응)
cp /defaults/menu.xml ${HOME}/.config/labwc/menu.xml
cp /defaults/menu.xml ${HOME}/.config/labwc/menu_wayland.xml

if [ "${SELKIES_DESKTOP}" == "true" ]; then
  labwc > /dev/null 2>&1 &
  sleep 1
  export WAYLAND_DISPLAY=wayland-0
  export DISPLAY=:0
  selkies-desktop
else
  labwc > /dev/null 2>&1
fi
