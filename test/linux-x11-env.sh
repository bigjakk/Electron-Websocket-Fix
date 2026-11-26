#!/usr/bin/env bash
# X11 test session for the Linux checks on a machine without a desktop or a GPU
# (the build VM): a repeatable X11 session of its own, Xorg with the dummy video
# driver (linux-x11-dummy.conf) and openbox as the window manager (no
# compositor).
#
#   linux-x11-env.sh start [N]          start Xorg and openbox on display :N (default 1)
#   linux-x11-env.sh stop               stop them
#   linux-x11-env.sh status
#
# start prints   export DISPLAY=:N   and the tests read it from the environment.
# status uses $DISPLAY when it is set, else the display of the last start. State
# and logs go to $KCC_X11_STATE, by default ~/.cache/kcc-x11-test.
#
# Needs sudo and systemd. Each part runs as a transient systemd unit (kcc-xorg,
# kcc-openbox), so it outlives the shell that started it. Xorg runs as root on
# VT 8 with access control off (-ac) and no TCP listener: a test machine only.
# Packages (Ubuntu 24.04): xserver-xorg-core xserver-xorg-video-dummy
# xserver-xorg-input-libinput openbox x11-utils.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${KCC_X11_STATE:-$HOME/.cache/kcc-x11-test}"
UNITS="kcc-openbox kcc-xorg"

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
  for u in $UNITS; do sudo systemctl stop "$u" 2>/dev/null || true; done

  sudo systemd-run --quiet --unit=kcc-xorg --collect /usr/bin/Xorg ":$n" vt8 \
    -config "$HERE/linux-x11-dummy.conf" -noreset -nolisten tcp -ac -s 0 -dpms \
    -logfile "$STATE/Xorg.$n.log"
  wait_for 30 "Xorg on :$n" xdpyinfo -display ":$n"

  sudo systemd-run --quiet --unit=kcc-openbox --collect --uid="$(id -u)" --gid="$(id -g)" \
    --setenv=DISPLAY=":$n" --setenv=HOME="$HOME" /usr/bin/openbox
  wait_for 15 "openbox" sh -c "DISPLAY=:$n xprop -root _NET_SUPPORTING_WM_CHECK | grep -q window"

  # Blanking is already off (-s 0 -dpms, BlankTime 0); xset (x11-xserver-utils)
  # only makes sure, when it is installed.
  if command -v xset >/dev/null; then DISPLAY=":$n" xset s off -dpms 2>/dev/null || true; fi
  echo "export DISPLAY=:$n"
}

stop() {
  for u in $UNITS; do sudo systemctl stop "$u" 2>/dev/null || true; done
  echo "stopped"
}

status() {
  local d
  d="$(xdisplay)"
  for u in $UNITS; do printf '%-12s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"; done
  if xdpyinfo -display "$d" >/dev/null 2>&1; then echo "X server on $d"; else echo "no X server on $d"; fi
}

case "${1:-}" in
  start) start "${2:-1}" ;;
  stop) stop ;;
  status) status ;;
  *) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 2 ;;
esac
