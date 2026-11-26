#!/usr/bin/env bash
# X11 test sessions for the Linux checks.
#
# On a machine without a desktop or a GPU (the build VM): a repeatable X11
# session of its own, Xorg with the dummy video driver and libinput input
# (linux-x11-dummy.conf), openbox as the window manager (no compositor), and a
# uinput virtual mouse (linux-vmouse.py), so that pointer acceleration and
# XInput2 raw motion take the same path as with a physical mouse.
# On a desktop (Xorg session, with or without a GPU): the virtual mouse alone,
# in the desktop's own X server ($DISPLAY); the desktop's libinput driver picks
# it up like a physical mouse.
#
#   linux-x11-env.sh start [N]          start everything on display :N (default 1)
#   linux-x11-env.sh start-mouse        in a desktop session: only the virtual
#                                       mouse, in the X server of $DISPLAY
#   linux-x11-env.sh stop               stop whatever of the above runs
#   linux-x11-env.sh status
#   linux-x11-env.sh accel adaptive|flat [SPEED]
#                                       pointer acceleration of the virtual mouse
#                                       (libinput profile; SPEED -1..1, default 0)
#   linux-x11-env.sh mouse CMD ...      send a command to the virtual mouse and wait
#                                       for it (see linux-vmouse.py: move, click, ...)
#
# start prints   export DISPLAY=:N   and   export KCC_VMOUSE_FIFO=<state>/vmouse.fifo,
# start-mouse the second; the tests read both from the environment. accel,
# status and mouse use $DISPLAY when it is set, else the display of the last
# start. State and logs go to $KCC_X11_STATE, by default ~/.cache/kcc-x11-test.
#
# Needs sudo and systemd. Each part runs as a transient systemd unit (kcc-xorg,
# kcc-vmouse, kcc-openbox), so it outlives the shell that started it. The mouse
# runs as root (/dev/uinput). Xorg runs as root on VT 8 with access control off
# (-ac) and no TCP listener: a test machine only. Packages (Ubuntu 24.04):
# xserver-xorg-core xserver-xorg-video-dummy xserver-xorg-input-libinput openbox
# python3-evdev x11-utils xinput xdotool; on a desktop python3-evdev xinput
# xdotool x11-utils are enough. Under a Wayland session (XWayland) the virtual
# mouse is the compositor's, not an X input device: accel cannot set it there.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${KCC_X11_STATE:-$HOME/.cache/kcc-x11-test}"
FIFO="$STATE/vmouse.fifo"
MOUSE="kcc-virtual-mouse"
UNITS="kcc-openbox kcc-vmouse kcc-xorg"

display_num() { cat "$STATE/display" 2>/dev/null || echo 1; }
xdisplay() { echo "${DISPLAY:-:$(display_num)}"; }

wait_for() {  # seconds, description, command...
  local secs=$1 what=$2; shift 2
  for _ in $(seq $((secs * 10))); do "$@" >/dev/null 2>&1 && return 0; sleep 0.1; done
  echo "timed out after ${secs}s waiting for $what" >&2; return 1
}

start() {
  local n="${1:-1}"
  mkdir -p "$STATE"; echo "$n" > "$STATE/display"
  [ -p "$FIFO" ] || mkfifo -m 0600 "$FIFO"
  for u in $UNITS; do sudo systemctl stop "$u" 2>/dev/null || true; done
  rm -f "$FIFO.done"

  sudo systemd-run --quiet --unit=kcc-xorg --collect /usr/bin/Xorg ":$n" vt8 \
    -config "$HERE/linux-x11-dummy.conf" -noreset -nolisten tcp -ac -s 0 -dpms \
    -logfile "$STATE/Xorg.$n.log"
  wait_for 30 "Xorg on :$n" xdpyinfo -display ":$n"

  sudo systemd-run --quiet --unit=kcc-vmouse --collect \
    /usr/bin/python3 -I "$HERE/linux-vmouse.py" serve "$FIFO"
  wait_for 15 "$MOUSE in xinput" sh -c "DISPLAY=:$n xinput list --name-only | grep -qx '$MOUSE'"

  sudo systemd-run --quiet --unit=kcc-openbox --collect --uid="$(id -u)" --gid="$(id -g)" \
    --setenv=DISPLAY=":$n" --setenv=HOME="$HOME" /usr/bin/openbox
  wait_for 15 "openbox" sh -c "DISPLAY=:$n xprop -root _NET_SUPPORTING_WM_CHECK | grep -q window"

  # Blanking is already off (-s 0 -dpms, BlankTime 0); xset (x11-xserver-utils)
  # only makes sure, when it is installed.
  if command -v xset >/dev/null; then DISPLAY=":$n" xset s off -dpms 2>/dev/null || true; fi
  echo "export DISPLAY=:$n"
  echo "export KCC_VMOUSE_FIFO=$FIFO"
  DISPLAY=":$n" xinput list --short
}

start_mouse() {
  [ -n "${DISPLAY:-}" ] || { echo "start-mouse: DISPLAY is not set (run it in the desktop session)" >&2; return 2; }
  mkdir -p "$STATE"
  [ -p "$FIFO" ] || mkfifo -m 0600 "$FIFO"
  sudo systemctl stop kcc-vmouse 2>/dev/null || true
  rm -f "$FIFO.done"
  sudo systemd-run --quiet --unit=kcc-vmouse --collect \
    /usr/bin/python3 -I "$HERE/linux-vmouse.py" serve "$FIFO"
  wait_for 15 "$MOUSE in xinput on $DISPLAY" sh -c "xinput list --name-only | grep -qx '$MOUSE'"
  echo "export KCC_VMOUSE_FIFO=$FIFO"
  xinput list --short
}

stop() {
  [ -p "$FIFO" ] && timeout 5 python3 -I "$HERE/linux-vmouse.py" send "$FIFO" quit 2>/dev/null || true
  for u in $UNITS; do sudo systemctl stop "$u" 2>/dev/null || true; done
  echo "stopped"
}

status() {
  for u in $UNITS; do printf '%-12s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"; done
  DISPLAY="$(xdisplay)" xinput list --short 2>/dev/null || echo "no X server on $(xdisplay)"
}

accel() {
  local profile="$1" speed="${2:-0}" d prop count values
  d="$(xdisplay)"
  prop="libinput Accel Profile Enabled"
  count=$(DISPLAY=$d xinput list-props "$MOUSE" | awk -F: -v p="$prop" \
          'index($0, p " (") { n = split($2, v, ","); print n; exit }')
  [ -n "$count" ] || { echo "no '$prop' on $MOUSE" >&2; return 1; }
  case "$profile" in
    adaptive) values="1 0" ;;
    flat) values="0 1" ;;
    *) echo "accel adaptive|flat [SPEED]" >&2; return 2 ;;
  esac
  for _ in $(seq $((count - 2))); do values="$values 0"; done
  DISPLAY=$d xinput set-prop "$MOUSE" "$prop" $values
  DISPLAY=$d xinput set-prop "$MOUSE" "libinput Accel Speed" "$speed"
  DISPLAY=$d xinput list-props "$MOUSE" | grep -E "libinput Accel (Speed|Profile Enabled) \("
}

case "${1:-}" in
  start) start "${2:-1}" ;;
  start-mouse) start_mouse ;;
  stop) stop ;;
  status) status ;;
  accel) shift; accel "$@" ;;
  mouse) shift; python3 -I "$HERE/linux-vmouse.py" send "$FIFO" "$@" ;;
  *) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2 ;;
esac
