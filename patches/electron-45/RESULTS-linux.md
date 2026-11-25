# Electron v45.4.1 KCC series on Linux (x64): build and check results

Build of Electron **v45.4.1** (Chromium **156.0.8078.100**, V8 **15.6.75.57**) with the patch
series in this directory, for Linux x64, on the machine described below. The Windows build
and its results are in [RESULTS.md](RESULTS.md); this file covers only Linux. Raw logs stay
on the build machine under `results/linux/` (not committed). Nothing was tested in the game.

> **What this machine can and cannot show.** The build machine is a **headless KVM guest with
> no GPU**: Chromium renders in software (SwiftShader), and the tests run in a dedicated X
> server, **Xorg with the dummy video driver**, with openbox as the window manager (no
> compositor) and a uinput virtual mouse driven through libinput (see
> [Test environment](#test-environment)). Every result in this file is a **build-machine
> result under software rendering**. The Windows build machine had the same limit; its
> results were later confirmed on a PC with a real GPU. The Linux Release build is to be
> checked the same way on a Linux machine with a GPU: frame rates, c50's effect under a real
> compositor and c51 with a physical mouse are statements for that machine, not this one.

> **Status:** in progress (Stages 0 to 2 done, with the c51 fix of Stage 2; Stage 3 Release build
> running).

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
- **Series.** `apply.sh --check`: 22 ok, 0 failed; then `apply.sh --commit`: 19 commits in
  `src`, 2 in `src/electron`, 1 in `src/v8`, on the base commits in
  [`results/linux/stage0/base-commits.txt`](results/linux/stage0/base-commits.txt).
- **c51 fix** (before the first build, as the brief asked): the bug recorded in c51's
  description under "Found in a desk-check on 2026-11-21". Turning raw motion on reset the
  button state of raw mousemoves to none, and the X server queues a motion's raw event before
  its core event, so with a lock taken in a mousedown handler the first raw mousemove said no
  button was down. The state is now taken from the X server's current button mask when raw
  motion is turned on, as the description proposed; the description says so. The change is in
  `ui/events/devices/x11/device_data_manager_x11.h` and `ui/ozone/platform/x11/x11_window.cc`,
  X11-only files: nothing Windows compiles changed.
- **Other checkouts.** `src` lists 12 submodule pointers as modified, and no file edits. Eleven
  are the checkouts Electron patches with commits of its own; each is at the recorded commit
  plus exactly Electron's patch count (angle 19, boringssl 2, dawn 10, ffmpeg 5,
  libaddressinput 1, minigbm 1, pdfium 4, skia 5, sqlite 1, webrtc 1, v8 37 plus the series'
  v01). The twelfth, `third_party/instrumented_libs`, is an unmanaged leftover of an older tree:
  DEPS checks it out only under `checkout_instrumented_libraries` (False), only MSan builds use
  it, and nothing in this build refers to it.

## Stage 1: DCHECK build

```gn
# out/Testing/args.gn
import("//electron/build/args/testing.gn")
use_remoteexec = false
use_reclient = false
symbol_level = 0
override_electron_version = "45.4.1"
```

The brief's arguments, plus `override_electron_version` as in the Release arguments. Without
it Electron takes the nearest tag of `src/electron`, which is also v45.4.1, so it changes
nothing; it only keeps the version independent of the tags in the checkout. `gn gen`: 36603
targets.

- **Early pass** (11 min): the eight patched sources most likely to break, compiled on their
  own first: c51's `device_data_manager_x11.cc`, `x11_extension.cc` and
  `desktop_window_tree_host_linux.cc`, `x11_window.cc` (c50 and c51), `begin_frame_source.cc`
  (c60), `display_scheduler.cc` (c03, c60), `command_buffer_stub.cc` and `gl_features.cc`
  (c32). All compiled.
- **Full build**: `autoninja -C out/Testing -k 0 -j 12 electron`, 41610 steps, **0 failed**,
  7 h 40 min from the start with the early pass (12 threads, no remote execution).
- **Fixes needed: none.** No patch changed in Stage 1. c50 and c51 compiled as drafted (with
  the c51 fix above), and so did the Linux halves of c12 and c15; c32 and the Windows-only c13,
  c14, c31 and c60 applied and did not break the build. c15 needed no extra include.
- After the build: `apply.sh --check --base results/linux/stage0/base-commits.txt` reports
  22 ok, and base + diffs = HEAD in `src`, `src/electron` and `src/v8`; `refresh.sh` reports
  0 changed, 22 unchanged. e10's `lib/browser/api/web-contents.ts` change is in the rebuilt
  browser bundle (`gen/internal/electron/js2c/browser_init.js` calls
  `_setInputEventObserved` and `_setBeforeMouseEventObserved`).
- `electron --version`: `v45.4.1`. Without `--no-sandbox` the binary stops at start-up with
  Chromium's "No usable sandbox!" (Ubuntu 23.10 and later; see [Drivers](#drivers)).

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
test/linux-x11-env.sh start-mouse      # on a desktop instead: the virtual mouse alone, in $DISPLAY
test/linux-x11-env.sh accel adaptive 1 # libinput profile and speed of the virtual mouse
test/linux-x11-env.sh mouse move 200 120 40 2
test/linux-x11-env.sh stop
```

### Drivers

The Windows drivers (`run-*.ps1`, `kcc-flags.ps1`) are PowerShell. Their Linux counterparts,
in Node, keep the same pass rules, feature list, arguments and re-run rules:

| Windows | Linux |
|---|---|
| `kcc-flags.ps1` | `linux-common.js` (also the platform switches, below) |
| `run-ws-gate.ps1` | `linux-run-ws-gate.js` |
| `run-frame-cap-gate.ps1` | `linux-run-frame-cap-gate.js` (variants `off`, `all`; `precise` is Windows-only) |
| `run-checks.ps1` | `linux-run-checks.js` (c10, c11, e10, c21, v01, c20/c30, c40, c41, plus c50 and c51) |
| `run-stage.ps1` | `linux-run-stage.js` |
| `raw-input-test.js` + `send-input.ps1` | `x11-raw-mouse-test.js` + `linux-vmouse.py` (c51; also c12 and c15 on the X11 raw path) |
| (none) | `x11-window-props-test.js` (c50) |

The drivers use the X server in `$DISPLAY`. Every run gets `--ozone-platform=x11`; two more
switches are for particular machines and are **off unless asked for**, so that a run on a
desktop with a GPU never gets them by accident. Every summary and log header records the
switches its runs used. On this machine every run used both:

- `--no-sandbox` (driver option `--no-sandbox`): Ubuntu 24.04 restricts unprivileged user
  namespaces, and the `chrome-sandbox` helper of a build directory or an unpacked zip is
  not setuid root, so electron cannot start its sandbox here; the v42 to v44 Linux tests ran
  the same way.
- `--disable-gpu --enable-unsafe-swiftshader` (driver option `--software-rendering`): without
  a GPU and without these switches the GPU process exits at start-up until Chromium disables
  GPU access, and WebGL is unavailable (`frame-cap.html` then silently draws on a 2D canvas;
  the Linux frame-cap driver fails such a WebGL suite). With `--enable-unsafe-swiftshader`
  alone the page's WebGL2 context was lost at load in **5 of 5** launches of
  `webgl-startup-test.js` (v44.0.0 binary); with `--disable-gpu` added, 0 of 5. That
  combination gives what the Windows build machine had: software compositing
  (`gpu_compositing: disabled_software`) and WebGL on a software rasteriser (ANGLE over
  SwiftShader here, over WARP there). The third combination tried,
  `--use-angle=swiftshader`, puts the display compositor on SwiftShader's Vulkan device: no
  loss, but a different output path from the Windows reference and about a third of the
  frame rate, so it is not used.

Without a virtual mouse (`KCC_VMOUSE_FIFO` unset) the c51 runs, and with them c12 and c15 on
the X11 raw path, are reported as SKIP, and the last line says which checks were skipped;
the Alt+Tab part of c51 is skipped only when an Alt+Tab with no lock held does not move the
focus either (the test runs that control first).

Dry run of the harness on the archived v44.0.0 Linux build (stock for c50 and c51): the
unadjusted lock is refused (`NotSupportedError`) and the plain lock follows acceleration
and hand speed: the same (200,120) device counts arrived as (200,120) with the flat
profile, (679,407) with a fast swipe and (201,121) with a slow one under the adaptive
profile, while XI2 raw motion was (200,120) every time. That is the behaviour c51 is meant
to replace.

For a Linux machine with a physical mouse, `x11-raw-mouse-test.js --kcc-manual=SECONDS` takes
the lock the same way, asks for a free movement of the mouse and prints the page's movement
sums next to the XInput2 raw motion of the same interval (device counts and accelerated
values): a raw lock must equal the device counts.

## Stage 2: the DCHECK build under test

Run on 2026-11-25, 05:09 to 05:49 UTC, on the idle machine, in the X server above:

```sh
node test/linux-run-stage.js --exe out/Testing/electron --out results/linux/stage2-testing \
     --ws-runs 6 --features-via js --software-rendering --no-sandbox
```

`gpu-status.js`: Electron 45.4.1, Chrome 156.0.8078.100, V8 15.6.75.57-electron.d384e85dffdbe2dd,
Node 24.22.3; `gpu_compositing: disabled_software`; WebGL2 renderer "ANGLE (Google, Vulkan 1.3.0
(SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"; GPU device 1234:1111 (the
VM's VGA). Every figure below is a software-rendering figure from the build machine.

### WebSocket gate

Every run: 0 % of messages over 50 ms, p99 under 50 ms, rendered frames. Six runs each way.

| Run | Switches off: p99 / max / over 50 ms / rAF frames | Every switch on: p99 / max / over 50 ms / rAF frames |
|---|---|---|
| 1 | 25.5 / 64.2 ms / **1 of 762** / 2906: **fail**; re-run: 27.4 / 41.5 ms / 0 of 760 / 2742 | 29.7 / 41.5 ms / 0 of 783 / 2819 |
| 2 | 29.3 / 46.6 ms / 0 of 754 / 2931 | 24.7 / 40.2 ms / 0 of 792 / 2973 |
| 3 | 25.8 / 35.9 ms / 0 of 763 / 2914 | 23.7 / 38.6 ms / 0 of 796 / 3281 |
| 4 | 27.7 / 30.5 ms / 0 of 770 / 2989 | 25.8 / 36.2 ms / 0 of 785 / 2855 |
| 5 | 27.8 / 39.3 ms / 0 of 763 / 2781 | 25.1 / 33.5 ms / 0 of 788 / 2840 |
| 6 | 26.9 / 41.7 ms / 0 of 761 / 2716 | 24.1 / 37.3 ms / 0 of 793 / 2873 |

- **Every switch on: pass**, 6 of 6 runs clean.
- **Switches off: environment-limited, not a pass.** The drivers' re-run rule passes it (one
  failed run, clean on its re-run), but the first attempt of run 1 had one message at 64.2 ms.
  The same gate on this VM with v44.0.0 (2026-08, Xvfb, 4 runs): p99 32.7, 44.5, 29.8 and
  31.6 ms; 2 of 750, 4 of 762, 0 and 0 messages over 50 ms (max 55.9, 69.0, 38.4, 39.1 ms). One
  v44.0.0 run in this session's X server (during the Stage 1 compile): p99 30.2 ms, 0 of 762.
  With no KCC switch, the WebSocket path is the ported c01, the same code as v44.

### Frame-cap gate

Variants `off` (no KCC switch) and `all` (every switch and the V8 flag); features passed
through the main script (`--kcc-features`), as a DCHECK build needs. The launch suite runs a
2D page in a 640x480 window: the cap at launch, after hide/show, after a resize to 800x600
(`setContentSize`, then 1 s before measuring), then back at 640x480 `setFrameCap(0)` and the
cap again. Measurement windows are 10 s; a cap is met within 1 %.

| Launch suite, fps | cap | after hide/show | after resize (800x600) | uncapped (640x480) | re-cap |
|---|---|---|---|---|---|
| off, 60 | 60.00 | 60.01 | 60.00 | 642.98 | 60.00 |
| off, 144 | 144.00 | 144.01 | 144.11 | 626.49 | 144.01 |
| off, 240, attempt 1 | 240.04 | 240.04 | **236.01 (-1.66 %)** | 404.83 | 240.04 |
| off, 240, attempt 2 | 240.04 | 240.04 | **237.04 (-1.23 %)** | 637.18 | 240.04 |
| all, 60 | 60.00 | 60.00 | 60.02 | 643.56 | 60.00 |
| all, 144 | 144.01 | 144.01 | 144.11 | 644.45 | 144.01 |
| all, 240 | 240.04 | 240.04 | 238.87 (-0.47 %) | 627.03 | 240.04 |

Runtime suite (`setFrameCap` while running), fps:

- 2D, off: uncapped baseline 401.07; caps 60.00, 144.01, 240.04; 144 after hide/show 144.01,
  after resize 144.01; a change of N at once: 240.49, 60.48, 144.49; uncapped reference 635.03;
  `setFrameCap(0)` 636.97; two views uncapped 519.37 / 525.43, cap 144 144.01 / 144.01,
  cap 60 60.00 / 60.00, uncapped again 524.22 / 530.87.
- 2D, all: uncapped baseline 383.89; caps 60.00, 144.00, 240.10; 144 after hide/show 144.01,
  after resize 144.01; at once 240.28, 60.49, 144.49; uncapped reference 651.47;
  `setFrameCap(0)` 619.80; two views uncapped 499.28 / 503.54, cap 144 144.02 / 144.01, cap 60
  60.00 / 60.00, uncapped again 494.25 / 489.23.
- WebGL2, off: uncapped baseline 121.40, so caps 144 and 240 are out of reach and the suite
  uses 90, 72 and 60 instead (SKIP lines in the summary): 60.00; 90 after hide/show 90.00;
  uncapped at 800x600 82.12, so 60 after resize 60.00; at once 72.01, 60.00, 90.01; uncapped
  reference 126.28; `setFrameCap(0)` 121.91; two views uncapped 110.38 / 110.38, cap 60 60.00 /
  60.00, uncapped again 110.64 / 110.64.
- WebGL2, all: uncapped baseline 119.84; 60.00; 90 after hide/show 90.00; uncapped at 800x600
  81.82; 60 after resize 60.00; at once 72.01, 60.01, 90.00; uncapped reference 124.54;
  `setFrameCap(0)` 121.51; two views uncapped 112.58 / 112.58, cap 60 60.00 / 60.00, uncapped
  again 115.44 / 115.44.

Heavy suite (WebGL2 page spinning 5 ms and 3 ms per frame, 5 runs per variant, interleaved;
best / median of each variant, every run in the summary): busy 5 ms, uncapped reach off 117.8
/ 116.8, all 117.6 / 115.9; cap 1000 all vs off +0.3 %, cap 240 -0.1 %, cap 144 -1.4 % (best,
limit -3 %). Busy 3 ms: reach off 129.5 / 124.5, all 127.3 / 125.7; cap 1000 -1.2 %, cap 240
+1.9 %, cap 144 +1.5 %. All within the rule.

**The gate failed as run, on one item:** `off`, launch cap 240 after the resize, 236.01 and
237.04 fps on the two attempts (the rule allows one re-run). The two measurements had a p99
frame interval of 7.1 and 6.2 ms and a longest one of 17.1 and 18.5 ms, against 4.17 ms for
240: late frames, not a cap held too long. The same item in the `all` variant, which runs the
same frame-cap code on Linux (c60 is Windows-only), read 238.87.

**Control** (15:15 to 15:30 UTC, idle machine): the launch suite at cap 240, five times each,
interleaved, with the same arguments, on the archived v44.0.0 build (the same frame-cap design,
an official build) and on the 45 DCHECK binary (off and all):

| After resize (800x600), fps | runs | within 1 % | uncapped at 640x480 |
|---|---|---|---|
| v44.0.0 (official build) | 240.04, 240.04, 240.04, 240.04, 240.04 | 5 of 5 | 1270, 1347, 1309, 1307, 1307 |
| 45 DCHECK, off | 240.04, 240.04, 240.04, 240.00, 240.04 | 5 of 5 | 566, 358, 550, 319, 354 |
| 45 DCHECK, all | 240.04, 239.64, 240.04, 240.04, 240.04 | 5 of 5 | 344, 343, 334, 554, 533 |

Every other item of those 15 runs passed too. The miss did not come back in ten runs of the
same binary; its uncapped rate varied from 319 to 566 fps between runs on this VM. The DCHECK
build reaches half of what the official v44 does here, so v44 against this binary does not
separate the port from the build type. The official 45 build gets the same five runs in
Stage 3 (below).

### Checks

| Check | Result on the DCHECK build |
|---|---|
| c10 | Pass: flags off and on, the page saw [keydown KeyA, keyup KeyA] through `sendInputEvent` and through CDP |
| e10 | Pass: 10 of 10 checks with KccSkipUnobservedInputEmits off and on |
| c11 | Pass: re-lock 35 ms after Esc refused (SecurityError) with the switch off, locked 34 ms after Esc with it on |
| c21 | Pass: fast and no-fast paths give the same error and pixel hashes (err 2ac24dc, pix 4b3ace96; 11205 GL errors on purpose), loop 11720 / 12132 ms, TurboFan on both; no context loss |
| v01 | Pass: the flag is listed by `--v8-options`; CppGC sweep slices stock 5 ms (max 6.7 ms), with the flag at 1 ms max 2.3 ms, at 2 ms max 4.0 ms |
| c20 | Pass: RecordMetrics trace slices off 5, on 0 |
| c30 | Pass: the texture-rebind page ran without crash or DCHECK, glError 0, no context loss, 482 frames |
| c31 | N/A: Windows-only (DCompPresenter); this build does not define the feature |
| c40 | Pass: with the switch every scenario stays flat (growth at most 1.5x); stock grew more than 3x in 4 of 4 |
| c41 | Pass: four renders (off twice, on twice), one distinct buffer, identical sample for sample |
| c50 | Pass (the hint only): `_NET_WM_BYPASS_COMPOSITOR` ordinary / transparent / non-focusable window = 2 / 2 / 2 switch off, 1 / 2 / 2 with KccX11AllowUnredirect and with every switch; window manager Openbox, all three windows depth 24. No compositor runs here: whether one unredirects the window is not tested |
| c51 | **Failed, then fixed** (below); after the fix every c51 check passes |
| c12, c15 (X11 raw path) | Failed only through c51's double count; pass after the fix |

### c51: every raw motion counted twice, found and fixed

With the raw lock, every phase read twice the device counts: (400,240) for a (200,120) swipe
under the flat profile, the adaptive profile fast, and slow; 200 for 100 with a held button;
c12 and c15 failed the same way. The lock itself, Esc, Alt+Tab, the focus gate and the button
state were right. The page saw exactly 2.00 dispatched moves (coalesced events) per XInput2
raw event in every phase; with the plain lock, 1.00.

Temporary logging (not kept) at three layers of the browser, for one run of the c51 checks:
`x11::Connection::DispatchEvent()` received 720 raw events, 360 distinct (pairs with the same
sequence number, server time, device 2, source 11, opcode 17); `X11Window::OnEvent()` took
720, `OnRawMouseMotion()` dispatched 720, and content's locked-mouse path saw 720. So the X
server sends each master-pointer raw event twice to this client, while `xinput test-xi2`, which
holds no grab, gets it once. The reason is in xorg-server 21.1.12 (`dix/events.c`, read from
the release tarball): pointer lock holds an owner-events grab on the window, so
`DeliverGrabbedEvent()` walks from the window under the pointer up to the root and hands the
event to this client's own root-window selection; `DeliverRawEvent()` then delivers it to the
root windows again, because `FilterRawEvents()` skips that delivery only for a grab whose
window is the root.

Fix (c51's own files, Linux/X11 only): XI_RawMotion is selected for all devices, inside the
root-window mask `DeviceDataManagerX11` already keeps for `DeviceId::All`, and only the slave
pointer's own copy (`deviceid == sourceid`, attached to a master) is counted. The slave device
is not grabbed by pointer lock, and the implicit grab of a held button has no owner events, so
its copy arrives once. The description at the top of the diff says what changed and why.

Re-run of the c51 checks on the rebuilt DCHECK binary (15:36 UTC; the Release compile was
running, these checks only count events). Raw events / dispatched moves / page mousemoves, and
the movement sum:

| Switches | flat, fast | adaptive, fast | adaptive, slow | held button | none held |
|---|---|---|---|---|---|
| c51 | 40 / 40 / 8, (200,120) | 40 / 40 / 7, (200,120) | 200 / 200 / 102, (200,120) | 20 / 20 / 5, 100 | 20 / 20 / 4, 100 |
| c51 + c12 | 40 / 40 / 7, (200,120) | 40 / 40 / 7, (200,120) | 200 / 200 / 104, (200,120) | 20 / 20 / 5, 100 | 20 / 20 / 5, 100 |
| every switch (c15 makes coalesced lists one long) | 40 / 7 / 7, (200,120) | 40 / 7 / 7, (200,120) | 200 / 101 / 101, (200,120) | 20 / 4 / 4, 100 | 20 / 5 / 5, 100 |
| off (plain lock, the control) | 40 / 24 / 7, (200,120) | 40 / 36 / 8, (675,405) | 200 / 201 / 103, (201,121) | 20 / 16 / 4, 100 | 20 / 19 / 5, 100 |

- c51: the lock resolves; movement equals the device counts in every phase with c51 alone and
  with every switch; Esc releases it and the mouse moves afterwards; Alt+Tab releases it, the
  focus goes to the other application and (100,0) moved there does not reach the page (0,0);
  a lock taken in a mousedown handler with the button held: 0 of 3 locked mousemoves with
  buttons 0. Held button: 5 moves, `buttons` 1 on every one, movement 100; after the release 4
  moves with `buttons` 0; with no button held 4 moves with `buttons` 0 (every switch: 4, 5 and
  5 moves, the same values).
- c12: after `requestPointerLock()` without options on a raw lock, c51 alone falls back to
  accelerated movement, (735,440); with KccPinRawPointerLock it stays raw, (200,120).
- c15: c51 alone, coalesced lists up to 10 long and predicted up to 10; with
  KccLeanLockedMouseMove 1 and 0, the coalesced entries sum to 200.

The gates do not exercise c51 (no pointer lock), so their DCHECK results above stand; the
official build runs all of it again.
