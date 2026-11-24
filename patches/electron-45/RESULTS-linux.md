# Electron v45.4.1 KCC series on Linux (x64): build and check results

Build of Electron **v45.4.1** (Chromium **156.0.8078.100**, V8 **15.6.75.57**) with the patch
series in this directory, for Linux x64, on the machine described below. The Windows build
and its results are in [RESULTS.md](RESULTS.md); this file covers only Linux. Raw logs stay
on the build machine under `results/linux/` (not committed). Nothing was tested in the game.

> **What this machine can and cannot show.** The build machine is a **headless KVM guest with
> no GPU**: Chromium renders in software (SwiftShader), and the tests run in a dedicated X
> server, **Xorg with the dummy video driver**, with openbox as the window manager (no
> compositor) and a uinput virtual mouse driven through libinput (see
> [Test environment](#test-environment)). The Windows build machine had the same limit; its
> results were later confirmed on a PC with a real GPU. Whether a GPU-backed Linux desktop is
> available for the same confirmation is the user's call.

> **Status:** in progress (Stage 0 done; Stage 1 running).

## Machine (Stage 0)

| | |
|---|---|
| OS | Ubuntu 24.04.5 LTS (noble), kernel 6.8.0-151-generic, x64 |
| Machine | KVM guest; CPU "QEMU Virtual CPU version 2.5+", **12 cores / 12 threads** |
| RAM | 31 GiB, plus a 24 GB swap file switched on for the build (the v44 Linux ThinLTO link peaked at 26.4 GB RSS on this machine) |
| Disk | one 290 GB file system; **105 GB free** at the start, 183 GB after the old `out/Release` was cleaned (below) |
| GPU | **None.** QEMU standard VGA (PCI 1234:1111), no DRM driver, no `/dev/dri` |
| Session | No desktop: the machine is reached over SSH only. Tests run in their own X server ([Test environment](#test-environment)) |
| Toolchain | Node.js 22.23.5 (Electron 45 needs >= 22.18), Python 3.12.3, depot_tools (updated by gclient during the sync); `@electron/build-tools` is installed but not used: `gn gen` and `ninja` are run by hand with the brief's arguments |

Consequences of the missing GPU, for every result below:

- The display compositor runs the **software** output path; frame-cap pacing, the swap-ack
  release and the begin-frame source are the same code as with a GPU, but frame rates are
  those of a software rasteriser.
- No compositing window manager runs, so c50's effect (the compositor unredirecting the
  game) cannot be observed; only the window property it sets can.

## Source tree (Stage 0)

The tree of the v44.0.0 Linux build was reused: gclient root `~/electron` (solution
`src/electron`, unmanaged), git cache `~/git_cache`.

- **Before reuse.** `src/electron` was at tag v44.0.0 with two modified files, `src` at
  152.0.7977.54 plus Electron's 170 Chromium patches with 12 modified files, `src/v8` clean
  (Electron's 5 V8 patches). The 14 modified files were byte-identical to
  `patches/electron-44/` as of the v44 build; no other file in any of the 183 checkouts had
  local edits, and nothing was stashed. The edits were saved as two diffs outside the tree,
  then discarded.
- **Old build output.** The 79 GB `out/Release` of the v44 build was cleaned (`gn clean`)
  with the user's approval, after the archived v44 dist.zip had been checked against its
  recorded SHA-256.
- **Sync.** `src/electron` checked out at `v45.4.1`, then
  `gclient sync --force --reset --with_branch_heads --with_tags`.
  The first attempt stopped at the `src` checkout: `third_party/aria-practices/src` was a
  separate checkout at 152 (a gitlink) and is vendored into Chromium at 156, the only one of
  the 270 gitlinks to change that way, so git refused to overwrite the old checkout's files.
  The old checkout (pristine, no local changes) was moved out of the tree, not deleted, and
  the sync re-run.
- Four leftovers of earlier DEPS (`third_party/harfbuzz-ng`, `third_party/ink_stroke_modeler`,
  `third_party/libphonenumber/dist`, `third_party/xdg-utils`, about 210 MB, untracked) were
  left in place; Chromium 156 tracks nothing at those paths.

## Test environment

The machine has no desktop session, and the brief's X11 tests (c51 above all) need a real
input path: under Xvfb, `xdotool mousemove_relative` goes in through XTEST, which the X server
does not accelerate, so "movement does not change with pointer acceleration" would pass
without testing anything. The tests therefore run in a dedicated X server built from stock
Ubuntu packages, set up by [`test/linux-x11-env.sh`](../../test/linux-x11-env.sh):

- **Xorg 21.1** with the **dummy** video driver, one 1920x1080 screen at 60 Hz
  ([`test/linux-x11-dummy.conf`](../../test/linux-x11-dummy.conf)); input hot-plugged through
  udev and **libinput**, as on a desktop. Started as root on VT 8, no TCP listener, access
  control off (a test machine only).
- **openbox** as the window manager: focus, Alt+Tab. No compositor.
- A **uinput virtual mouse**, `kcc-virtual-mouse` (REL_X, REL_Y, REL_WHEEL and three
  buttons), created and moved by [`test/linux-vmouse.py`](../../test/linux-vmouse.py)
  (python3-evdev, run as root for `/dev/uinput`). The tests send it commands through a FIFO
  (`move DX DY [reports [ms]]`, `down`/`up`/`click`, `wheel`). libinput drives it like a
  physical mouse.
- Keys go in through XTEST (`xdotool key`).
- The VM's own input devices are attached as they would be on a desktop: a PS/2 keyboard, an
  absolute USB tablet and an absolute VMware VMMouse (c51 must ignore absolute devices).

Packages: `xserver-xorg-core xserver-xorg-video-dummy xserver-xorg-input-libinput openbox
python3-evdev x11-utils xinput xdotool` (plus Xvfb, already installed).

Check of the input path, before any patched build ran: a 400-count swipe of the virtual
mouse (40 reports, 2 ms apart) moved the X pointer by

| libinput profile | X pointer moved | XInput2 raw motion (master pointer) |
|---|---|---|
| flat, speed 0 | 400 px | 400.00 counts |
| adaptive, speed 0 | 794 px | 400.00 counts |
| adaptive, speed 1 | 1363 px | 400.00 counts |

so acceleration acts on core motion only and XI2 raw events carry the device counts, as with
a physical mouse.

```sh
test/linux-x11-env.sh start 1          # Xorg :1, openbox, virtual mouse; prints DISPLAY and KCC_VMOUSE_FIFO
test/linux-x11-env.sh accel adaptive 1 # libinput profile and speed of the virtual mouse
test/linux-x11-env.sh mouse move 200 120 40 2
test/linux-x11-env.sh stop
```

### Drivers

The Windows drivers (`run-*.ps1`, `kcc-flags.ps1`) are PowerShell. Their Linux counterparts,
in Node, keep the same pass rules, feature list, arguments and re-run rules:

| Windows | Linux |
|---|---|
| `kcc-flags.ps1` | `linux-common.js` (also adds `--ozone-platform=x11` and `--no-sandbox` to every run) |
| `run-ws-gate.ps1` | `linux-run-ws-gate.js` |
| `run-frame-cap-gate.ps1` | `linux-run-frame-cap-gate.js` (variants `off`, `all`; `precise` is Windows-only) |
| `run-checks.ps1` | `linux-run-checks.js` (c10, c11, e10, c21, v01, c20/c30, c40, c41, plus c50 and c51) |
| `run-stage.ps1` | `linux-run-stage.js` |
| `raw-input-test.js` + `send-input.ps1` | `x11-raw-mouse-test.js` + `linux-vmouse.py` (c51; also c12 and c15 on the X11 raw path) |
| (none) | `x11-window-props-test.js` (c50) |

`--no-sandbox`: Ubuntu 24.04 restricts unprivileged user namespaces, so an electron run from
a build directory cannot start its sandbox; the v42 to v44 Linux tests ran the same way.

Dry run of the harness on the archived v44.0.0 Linux build (stock for c50 and c51): the
unadjusted lock is refused (`NotSupportedError`) and the plain lock follows acceleration
and hand speed: the same (200,120) device counts arrived as (200,120) with the flat
profile, (679,407) with a fast swipe and (201,121) with a slow one under the adaptive
profile, while XI2 raw motion was (200,120) every time. That is the behaviour c51 is meant
to replace.
