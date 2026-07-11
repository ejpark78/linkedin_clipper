#!/usr/bin/env bash

# Start DE
rm -rf /tmp/.X11-unix
ulimit -c 0
export XCURSOR_THEME=breeze_cursors
export XCURSOR_SIZE=24
export XKB_DEFAULT_LAYOUT=us
export XKB_DEFAULT_RULES=evdev
export XKB_DEFAULT_OPTIONS=caps:swapescape
export WAYLAND_DISPLAY=wayland-1

# labwc menu 강제 설정 (볼륨 persist 대응)
cp /defaults/menu.xml ${HOME}/.config/labwc/menu.xml
cp /defaults/menu.xml ${HOME}/.config/labwc/menu_wayland.xml

export XDG_RUNTIME_DIR=/config/.runtime

if [ "${SELKIES_DESKTOP}" == "true" ]; then
  labwc > /dev/null 2>&1 &
  sleep 1
  export WAYLAND_DISPLAY=wayland-0
  export DISPLAY=:0
  selkies-desktop
else
  labwc > /dev/null 2>&1
fi
