#!/usr/bin/env python3
"""Virtual relative mouse for the X11 tests, for a machine without a mouse.

Creates a uinput device named "kcc-virtual-mouse" (REL_X, REL_Y, REL_WHEEL,
BTN_LEFT, BTN_RIGHT, BTN_MIDDLE) and moves it on command. An X server that
uses libinput treats it as a physical mouse: pointer acceleration applies to
its core motion, and XInput2 raw events carry the unaccelerated deltas. That
is what xdotool cannot give: its relative motion goes in through XTEST and is
not accelerated.

  linux-vmouse.py serve FIFO          create the device and run the commands
                                      written to FIFO, one per line. Needs
                                      write access to /dev/uinput (sudo).
  linux-vmouse.py send FIFO CMD ...   hand one command to a running server and
                                      wait until it has been executed.

Commands:
  move DX DY [N [MS]]   move by DX, DY device counts, split into N reports
                        (default 1) sent MS milliseconds apart (default 1).
                        The reports always add up to exactly DX, DY.
  down BTN | up BTN | click BTN       BTN is left, right or middle
  wheel N               N wheel detents (negative: towards the user)
  sleep MS
  quit                  remove the device and exit

Uses python3-evdev. Run it with python3 -I. Needs no other files.
"""
import os
import sys
import time

DONE_SUFFIX = ".done"


def split(total, n):
    """n integers that add up to total, as evenly as possible."""
    return [round((i + 1) * total / n) - round(i * total / n) for i in range(n)]


def serve(fifo):
    from evdev import UInput, ecodes as e

    buttons = {"left": e.BTN_LEFT, "right": e.BTN_RIGHT, "middle": e.BTN_MIDDLE}
    caps = {
        e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL],
        e.EV_KEY: list(buttons.values()),
    }
    ui = UInput(caps, name="kcc-virtual-mouse", bustype=e.BUS_USB,
                vendor=0x1d6b, product=0x0104, version=1)
    done_path = fifo + DONE_SUFFIX
    old_umask = os.umask(0o022)
    with open(done_path, "w"):
        pass
    os.umask(old_umask)
    print(f"kcc-virtual-mouse ready: {ui.device.path}", flush=True)

    # O_RDWR keeps a writer open, so the read never sees end-of-file between
    # clients.
    fd = os.open(fifo, os.O_RDWR)
    with os.fdopen(fd, "r") as commands:
        for line in commands:
            line = line.strip()
            if not line:
                continue
            ident = None
            if "#" in line:
                line, ident = (part.strip() for part in line.split("#", 1))
            words = line.split()
            op, args = words[0], words[1:]
            try:
                if op == "move":
                    dx, dy = int(args[0]), int(args[1])
                    n = int(args[2]) if len(args) > 2 else 1
                    ms = float(args[3]) if len(args) > 3 else 1.0
                    for i, (sx, sy) in enumerate(zip(split(dx, n), split(dy, n))):
                        if sx:
                            ui.write(e.EV_REL, e.REL_X, sx)
                        if sy:
                            ui.write(e.EV_REL, e.REL_Y, sy)
                        ui.syn()
                        if i + 1 < n:
                            time.sleep(ms / 1000.0)
                elif op in ("down", "up", "click"):
                    code = buttons[args[0]]
                    if op in ("down", "click"):
                        ui.write(e.EV_KEY, code, 1)
                        ui.syn()
                    if op == "click":
                        time.sleep(0.03)
                    if op in ("up", "click"):
                        ui.write(e.EV_KEY, code, 0)
                        ui.syn()
                elif op == "wheel":
                    ui.write(e.EV_REL, e.REL_WHEEL, int(args[0]))
                    ui.syn()
                elif op == "sleep":
                    time.sleep(float(args[0]) / 1000.0)
                elif op == "quit":
                    print("quit", flush=True)
                    break
                else:
                    print(f"unknown command: {line}", flush=True)
            except (IndexError, KeyError, ValueError) as err:
                print(f"bad command {line!r}: {err}", flush=True)
            if ident:
                with open(done_path, "a") as done:
                    done.write(ident + "\n")
    ui.close()


def send(fifo, words, timeout=60.0):
    ident = f"{os.getpid()}-{time.monotonic_ns()}"
    with open(fifo, "w") as f:
        f.write(" ".join(words) + " #" + ident + "\n")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with open(fifo + DONE_SUFFIX) as done:
                if ident in done.read().split():
                    return 0
        except FileNotFoundError:
            pass
        time.sleep(0.005)
    print(f"timed out waiting for: {' '.join(words)}", file=sys.stderr)
    return 1


def main(argv):
    if len(argv) >= 3 and argv[1] == "serve":
        serve(argv[2])
        return 0
    if len(argv) >= 4 and argv[1] == "send":
        return send(argv[2], argv[3:])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
