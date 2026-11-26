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

> **Status:** Stages 0 to 3 done. The official Release build and its dist.zip are made (Stage 3);
> every check and the WebSocket gate passed on it; the frame-cap gate failed as run on one
> heavy-suite item that this machine cannot resolve. The Release build is still to be run on a
> Linux machine with a GPU.

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
| (none) | `linux-run-heavy-aa.js` (the heavy suite again with an A/A control arm, only after a heavy comparison missed; Stage 3) |

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

## Stage 3: the official Release build

```gn
# out/Release/args.gn
import("//electron/build/args/release.gn")
is_official_build = true
use_remoteexec = false
use_reclient = false
override_electron_version = "45.4.1"
```

`gn gen`: 36572 targets. In effect: `is_official_build = true`, `is_debug = false`,
`dcheck_always_on = false`, no component build, `use_thin_lto = true`, `symbol_level = 2`,
`chrome_pgo_phase = 2` with Electron's stock profile for Linux x64
(`electron-linux-x64-1794713269-6bfc23bf15.profdata`) and the stock V8 builtins profile
(`electron-v8-x64-1794710512-6bfc23bf15.profile`), both checked against Electron's state files
before the build. Clang 24.0.0git (llvm-project 86922d51225d), no remote execution.

- **Build**: `autoninja -C out/Release -k 0 -j 12 electron`, 46047 steps, **0 failed**, 9 h 32 min
  (2026-11-25 15:32 to 2026-11-26 01:04 UTC). The first 3255 steps ran with 10 jobs while the
  Stage 2 c51 fix was being checked on the DCHECK build; ninja was then stopped by hand and
  restarted with 12 jobs on the same tree, which had the fix from the start. The ThinLTO link of
  `electron` took 35.5 min, with a peak `ld.lld` RSS of 26.5 GB and up to 7.8 GB of swap in use
  (the v44 link on this machine: 26.4 GB, about 13 min). Free disk: 169 GB at the start, 91 GB at
  the end of the compile.
- **Fixes needed: none.** No patch changed in Stage 3.
- **Before the zip**: no uncommitted source file in `src`, `src/electron` and `src/v8`;
  `apply.sh --check --base results/linux/stage0/base-commits.txt`: 22 ok, and base + diffs = HEAD
  in all three; `refresh.sh`: 0 changed, 22 unchanged; `ninja -n electron`: no work to do. Then
  `autoninja -C out/Release electron:electron_dist_zip` (10 steps: the strip actions of the
  Linux zip, the version and licence files, the zip), after which
  `ninja -n electron electron:electron_dist_zip` has no work to do.

| | |
|---|---|
| `out/Release/dist.zip` | **123997995 bytes**, SHA-256 `f3228381c30c9a076d3fb28a7820f1af5c023a8e7bdef1206e21ec20a354402f`, 72 files |
| Built from | `src` `0f02044a47d3ed65af3086953dd58f6d63b03a89`, `src/electron` `81cbfc5d4e08cf607efc19b1fba6e16c15a4271b`, `src/v8` `9bcdcbce24d4f0ef9475add913ead4a55be1bc79` |
| `electron` in the zip | stripped by the zip target (234663240 bytes; `out/Release/electron` with symbols is 1.3 GB); `--version` prints `v45.4.1`; `ldd` finds every library |

The gates and checks below ran `out/Release/electron`: the same build, with its symbols.

### Gates and checks

Run on 2026-11-26, 01:09 to 01:50 UTC, on the idle machine, in the same X server:

```sh
node test/linux-run-stage.js --exe out/Release/electron --out results/linux/stage3-release \
     --ws-runs 6 --software-rendering --no-sandbox
```

Features on the command line (`--enable-features`), as on Windows. `gpu-status.js`: Electron
45.4.1, Chrome 156.0.8078.100, V8 15.6.75.57-electron.d384e85dffdbe2dd, Node 24.22.3; software
compositing and WebGL2 on ANGLE over SwiftShader, as in Stage 2. Build-machine figures.

#### WebSocket gate

| Run | Switches off: p99 / max / over 50 ms / rAF frames | Every switch on: p99 / max / over 50 ms / rAF frames |
|---|---|---|
| 1 | 19.9 / 25.4 ms / 0 of 825 / 8267 | 20.4 / 26.9 ms / 0 of 825 / 7727 |
| 2 | 21.2 / 30.7 ms / 0 of 817 / 8287 | 19.4 / 25.8 ms / 0 of 829 / 7798 |
| 3 | 20.6 / 28.1 ms / 0 of 823 / 8108 | 20.1 / 25.8 ms / 0 of 828 / 7780 |
| 4 | 20.4 / 30.3 ms / 0 of 822 / 7928 | 19.6 / 29.6 ms / 0 of 829 / 7802 |
| 5 | 20.2 / 27.9 ms / 0 of 819 / 7802 | 19.7 / 27.1 ms / 0 of 827 / 7722 |
| 6 | 19.7 / 23.6 ms / 0 of 822 / 8014 | 19.9 / 25.3 ms / 0 of 824 / 7750 |

**Pass both ways**: 12 of 12 runs clean at the first attempt, the longest message 30.7 ms. The
Stage 2 verdict for the DCHECK build with the switches off (environment-limited, not a pass)
stays as written.

#### Frame-cap gate

Launch suite (2D page, 640x480; the same items as in Stage 2), fps:

| Launch suite | cap | after hide/show | after resize (800x600) | uncapped (640x480) | re-cap |
|---|---|---|---|---|---|
| off, 60 | 60.00 | 60.00 | 60.00 | 1945.98 | 60.00 |
| off, 144 | 144.01 | 144.01 | 144.01 | 1309.17 | 144.01 |
| off, 240 | 240.04 | 240.04 | 240.04 | 1990.00 | 240.04 |
| all, 60 | 60.00 | 60.00 | 60.00 | 1895.68 | 60.00 |
| all, 144 | 144.01 | 144.01 | 144.01 | 1303.47 | 144.01 |
| all, 240 | 240.04 | 240.04 | 240.04 | 1315.51 | 240.04 |

Runtime suite, fps. In the Release build the WebGL2 page reaches about 456 fps, so its suite
uses the caps 60, 144 and 240 as the 2D one does (the DCHECK build needed 90/72/60):

- 2D, off: uncapped baseline 1315.87; caps 60.00, 144.01, 240.04; 144 after hide/show 144.01,
  after resize 144.01; at once 240.03, 59.99, 143.98; uncapped reference 1885.31;
  `setFrameCap(0)` 1987.34; two views uncapped 1559.99 / 994.32, cap 144 144.01 / 144.01, cap 60
  60.00 / 60.00, `setFrameCap(0)` 1389.79 / 1389.24.
- 2D, all, attempt 1: **one item missed**: "two views, `setFrameCap(0)` uncaps both": before
  1692.20 / 1053.19, after 1346.19 / 1344.42; the first view came to 79.6 % of its rate before,
  the rule asks for 80 % (the two views together: 98 % of before). Everything else as in attempt
  2. Attempt 2 (the rule allows one re-run): uncapped baseline 1286.54; caps 60.00, 144.01,
  240.04; 144 after hide/show 144.01, after resize 144.01; at once 240.03, 59.99, 143.97;
  uncapped reference 1995.68; `setFrameCap(0)` 1951.06; two views uncapped 1316.46 / 1316.35,
  cap 144 144.01 / 144.01, cap 60 60.00 / 60.00, `setFrameCap(0)` 1337.23 / 1336.89: pass.
- WebGL2, off: uncapped baseline 456.55; caps 60.00, 144.01, 240.04; 144 after hide/show 144.01,
  after resize 144.01; at once 239.83, 59.95, 143.88; uncapped reference 453.34;
  `setFrameCap(0)` 479.72; two views uncapped 374.74 / 374.75, cap 144 144.01 / 144.01, cap 60
  60.00 / 60.00, `setFrameCap(0)` 382.82 / 382.87.
- WebGL2, all: uncapped baseline 458.29; caps 60.00, 144.01, 240.04; 144 after hide/show 144.01,
  after resize 144.01; at once 239.80, 59.94, 143.88; uncapped reference 480.35;
  `setFrameCap(0)` 498.58; two views uncapped 409.50 / 409.44, cap 144 144.01 / 144.01, cap 60
  60.00 / 60.00, `setFrameCap(0)` 397.89 / 397.86.

Heavy suite (the WebGL2 page spinning 5 ms and 3 ms per frame, 5 runs per variant, off and all
interleaved in every round; the rule: for each cap, the best run of `all` no more than 3 % below
the best run of `off`). Each run, uncapped / cap 1000 / cap 240 / cap 144:

| Busy, round | off | all |
|---|---|---|
| 5 ms, 1 | 145.3 / 146.2 / 145.6 / 144.0 | 147.1 / 147.7 / 149.5 / 144.0 |
| 5 ms, 2 | 150.3 / 149.8 / 149.2 / 143.9 | 150.4 / 149.6 / 149.3 / 143.9 |
| 5 ms, 3 | 149.5 / 149.5 / 147.8 / 144.0 | 149.9 / 148.4 / 148.8 / 144.0 |
| 5 ms, 4 | 148.8 / 149.5 / 148.6 / 144.0 | 150.2 / 150.8 / 149.7 / 144.0 |
| 5 ms, 5 | 149.3 / 150.0 / 149.9 / 144.0 | 150.6 / 151.1 / 150.5 / 144.0 |
| 3 ms, 1 | 199.9 / 201.2 / 198.8 / 144.0 | 200.1 / 200.1 / 199.4 / 144.0 |
| 3 ms, 2 | 215.0 / 217.7 / 217.7 / 144.0 | 198.7 / 198.4 / 198.1 / 144.0 |
| 3 ms, 3 | 200.1 / 201.1 / 199.6 / 144.0 | 197.1 / 190.0 / 189.4 / 144.0 |
| 3 ms, 4 | 205.5 / 208.0 / 204.3 / 144.0 | 188.3 / 188.1 / 190.3 / 144.0 |
| 3 ms, 5 | 208.6 / 209.8 / 212.9 / 144.0 | 211.9 / 212.1 / 210.8 / 144.0 |

- Busy 5 ms: all against off, best against best: cap 1000 +0.7 %, cap 240 +0.4 %, cap 144
  -0.0 %. Within the rule.
- Busy 3 ms: cap 1000 -2.6 % (medians -4.6 %), **cap 240 -3.2 %** (210.8 against 217.7; medians
  -3.1 %), cap 144 -0.0 %.

The gate failed as run on one item: heavy suite, busy 3 ms, cap 240, -3.2 % against a limit of
3 %. At busy 3 ms the page's own reach is under 240 fps in every run, so cap 240 is above
reach; within each variant cap 240 read about what the uncapped run did (best uncapped / best cap
240: off 215.0 / 217.7, all 211.9 / 210.8), and the gap between the variants is there uncapped
as well (best -1.4 %, medians -3.3 %). In the DCHECK build of Stage 2 the same comparison was
+1.9 %. The `all` run, as run:

```
electron frame-cap-test.js --kcc-suite=heavy --kcc-busy=3 --kcc-mode=webgl
  --enable-features=KccNoPointerLockEscCooldown,KccPinRawPointerLock,KccRawInputKeepWheelMotion,KccRawInputFastPath,KccLeanLockedMouseMove,KccSkipUnobservedInputEmits,KccSkipCanvasPerfSampling,KccLabelTexturesOnce,KccCacheVsyncInterval,KccMacFineGpuBackpressure,KccAudioParamCoalesce,KccHrtfPannerKRateAngles,KccX11AllowUnredirect,KccX11RawMouse,KccFrameCapPreciseRelease
  --js-flags=--cppheap-max-incremental-sweep-duration-ms=1 --kcc-out=<json> --enable-logging
  --ozone-platform=x11 --no-sandbox --disable-gpu --enable-unsafe-swiftshader
```

`off` is the same command without `--enable-features` and `--js-flags`.

**FRAME-CAP GATE: FAIL** (this machine, as run). The item was measured again with an A/A control,
next.

#### Re-measurement of the heavy-suite item

Measured again after the gate run, with an A/A control: a second `off` arm with the same command
line as `off` shows how far two identical arms drift apart on this machine. 02:08 to 02:31 UTC,
idle machine; busy 3 ms, the gate's WebGL2 page (ANGLE over SwiftShader); arms `off`, `all` and
`off2`, 10 rounds, the order rotated from round to round: rounds 1, 4, 7 and 10 ran off, all,
off2; rounds 2, 5 and 8 all, off2, off; rounds 3, 6 and 9 off2, off, all. The script of the build
session that ran it is in the repository as
[`test/linux-run-heavy-aa.js`](../../test/linux-run-heavy-aa.js) (the same command lines,
rotation and figures). 30 of 30 runs exited 0 with 3 of 3 checks, page `webgl2`; the CPU steal
time over every run was 0.01 to 0.04 % of all CPU time. Each run, uncapped / cap 1000 / cap 240
(cap 144 read 144.0 in all 30 runs):

| Round | off | all | off2 |
|---|---|---|---|
| 1 | 216.1 / 217.1 / 214.7 | 214.2 / 214.5 / 215.8 | 197.4 / 199.0 / 195.1 |
| 2 | 198.2 / 198.3 / 197.3 | 195.7 / 196.5 / 197.0 | 194.5 / 197.6 / 197.0 |
| 3 | 211.1 / 212.9 / 214.7 | 213.3 / 216.6 / 214.5 | 194.4 / 195.9 / 192.3 |
| 4 | 196.9 / 197.1 / 197.0 | 212.4 / 214.7 / 212.5 | 196.1 / 196.7 / 196.3 |
| 5 | 214.3 / 214.7 / 213.8 | 195.1 / 196.5 / 196.4 | 214.1 / 213.7 / 214.0 |
| 6 | 214.0 / 216.2 / 215.0 | 197.8 / 196.8 / 198.0 | 200.0 / 199.6 / 198.7 |
| 7 | 198.4 / 199.7 / 201.1 | 199.0 / 199.1 / 198.9 | 197.5 / 195.0 / 197.6 |
| 8 | 195.3 / 197.1 / 200.1 | 199.2 / 198.5 / 199.5 | 197.2 / 197.1 / 199.6 |
| 9 | 214.8 / 216.4 / 216.0 | 199.4 / 196.8 / 199.6 | 196.7 / 198.1 / 198.7 |
| 10 | 197.1 / 198.0 / 199.5 | 198.5 / 198.9 / 199.1 | 197.2 / 197.2 / 199.1 |

| | uncapped | cap 1000 | cap 240 | cap 144 |
|---|---|---|---|---|
| best / median: off | 216.1 / 204.8 | 217.1 / 206.3 | 216.0 / 207.4 | 144.0 / 144.0 |
| best / median: all | 214.2 / 199.1 | 216.6 / 198.7 | 215.8 / 199.3 | 144.0 / 144.0 |
| best / median: off2 | 214.1 / 197.2 | 213.7 / 197.4 | 214.0 / 198.1 | 144.0 / 144.0 |
| best against best (medians): all vs off | -0.9 % (-2.8 %) | -0.2 % (-3.7 %) | -0.1 % (-3.9 %) | 0.0 % (0.0 %) |
| all vs off2 | +0.0 % (+1.0 %) | +1.3 % (+0.6 %) | +0.8 % (+0.6 %) | 0.0 % (0.0 %) |
| off2 vs off (A/A) | -0.9 % (-3.7 %) | -1.6 % (-4.3 %) | -0.9 % (-4.5 %) | 0.0 % (0.0 %) |
| paired per round, median (rounds below zero): all - off | -0.7 fps, -0.3 % (5 of 10) | -1.2 fps, -0.6 % (6 of 10) | -0.5 fps, -0.2 % (8 of 10) | 0.0 |
| off2 - off (A/A) | -2.3 fps, -1.1 % (8 of 10) | -2.9 fps, -1.4 % (10 of 10) | -2.1 fps, -1.0 % (9 of 10) | 0.0 |

- The rates fell into **two groups**: at cap 240 every run read either 192.3 to 201.1 or 212.5 to
  216.0 fps, none in between. The upper group held 5 of the 10 `off` runs, 3 of the 10 `all` runs
  and 1 of the 10 `off2` runs; by position in the round, 1 of the 10 first runs, 6 of the 10
  second runs and 2 of the 10 third runs. CPU steal does not account for it. (In the gate run the
  rates spread over 188.3 to 217.7 without that gap.)
- **What it showed:** the A/A comparison moved as far as `all` against `off`, or further: best
  -0.9 % against -0.1 %, paired median -1.0 % against -0.2 %, medians -4.5 % against -3.9 % (cap
  240). On this machine, with software rendering, the 3 % rule cannot separate the two variants.
  This does not change the verdict: **the frame-cap gate failed as run, at -3.2 %; the item is not
  resolvable on this machine and is decided by the same gate on a machine with a GPU.** It is not
  a pass.

#### Frame-cap item of Stage 2: five runs on the official build

The control of Stage 2 again (01:53 to 02:08 UTC, idle machine): the launch suite at cap 240,
five times each, interleaved, with the gate's arguments, on the archived v44.0.0 build and on the
45 Release build, off and all:

| After resize (800x600), fps | runs | within 1 % | p99 / longest frame interval | uncapped at 640x480 |
|---|---|---|---|---|
| v44.0.0 (official build) | 240.04 ×5 | 5 of 5 | 4.30 ms every run / 4.4 to 4.7 ms | 1441, 1400, 1410, 1414, 1414 |
| 45 Release, off | 240.04 ×5 | 5 of 5 | 4.30 ms / 4.4 to 4.6 ms | 1455, 1462, 1406, 1381, 1372 |
| 45 Release, all | 240.04 ×5 | 5 of 5 | 4.30 ms / 4.4 to 4.9 ms | 1492, 1466, 1417, 1393, 1457 |

Every other item of the 15 runs passed too (launch and hide/show 240.04, re-cap 240.04, one v44
re-cap 240.14). The official 45 build holds cap 240 after the resize as v44 does, at the same
uncapped reach; with the gate run above (240.04 in off and all) that is 12 of 12 Release runs.
The Stage 2 miss (236.01 and 237.04 on the DCHECK build) did not come back on the official build.

#### Checks

| Check | Result on the Release build |
|---|---|
| c10 | Pass: flags off and on, the page saw [keydown KeyA, keyup KeyA] through `sendInputEvent` and through CDP |
| e10 | Pass: 10 of 10 checks with KccSkipUnobservedInputEmits off and on |
| c11 | Pass: re-lock 33 ms after Esc refused (SecurityError) with the switch off, locked with it on |
| c21 | Pass: fast and no-fast paths give the same error and pixel hashes (err 2ac24dc, pix 4b3ace96; 11205 GL errors on purpose), loop 6179 / 6596 ms, TurboFan on both; no context loss |
| v01 | Pass: the flag is listed by `--v8-options`; CppGC sweep slices stock 5 ms (max 5.5 ms), with the flag at 1 ms max 1.6 ms, at 2 ms max 2.6 ms |
| c20 | Pass: RecordMetrics trace slices off 8, on 0 |
| c30 | Pass: the texture-rebind page ran without crash, glError 0, no context loss, 765 frames |
| c31 | N/A: Windows-only (DCompPresenter); this build does not define the feature |
| c40 | Pass: with the switch every scenario stays flat (0.92x to 1.00x); stock grew 10.9x to 15.6x in 4 of 4 |
| c41 | Pass: four renders (off twice, on twice), one distinct buffer, identical sample for sample |
| c50 | Pass (the hint only): `_NET_WM_BYPASS_COMPOSITOR` ordinary / transparent / non-focusable = 2 / 2 / 2 switch off, 1 / 2 / 2 with KccX11AllowUnredirect and with every switch; Openbox, depth 24. No compositor here |
| c51 | Pass, every item (below) |
| c12, c15 (X11 raw path) | Pass: c12, c51 alone falls back to accelerated movement after `requestPointerLock()` without options, (822,492), and stays raw with KccPinRawPointerLock, (200,120). c15, c51 alone coalesced up to 8 and predicted up to 10; with KccLeanLockedMouseMove 1 and 0, coalesced entries sum 200 |

c51 on the Release build. Raw events / dispatched moves / page mousemoves, and the movement sum:

| Switches | flat, fast | adaptive, fast | adaptive, slow | held button | none held |
|---|---|---|---|---|---|
| c51 | 40 / 40 / 7, (200,120) | 40 / 40 / 7, (200,120) | 200 / 200 / 99, (200,120) | 20 / 20 / 4, 100 | 20 / 20 / 4, 100 |
| c51 + c12 | 40 / 40 / 7, (200,120) | 40 / 40 / 6, (200,120) | 200 / 200 / 99, (200,120) | 20 / 20 / 5, 100 | 20 / 20 / 4, 100 |
| every switch | 40 / 7 / 7, (200,120) | 40 / 7 / 7, (200,120) | 200 / 99 / 99, (200,120) | 20 / 5 / 5, 100 | 20 / 4 / 4, 100 |
| off (plain lock, the control) | 40 / 40 / 8, (200,120) | 40 / 42 / 9, (679,407) | 200 / 201 / 100, (201,121) | 20 / 20 / 4, 100 | 20 / 20 / 5, 100 |

The lock resolves; movement equals the device counts in every phase with c51 alone and with
every switch; Esc releases it and the mouse moves afterwards; Alt+Tab releases it, the focus goes
to the other application and movement there does not reach the page, (0,0); a lock taken in a
mousedown handler with the button held: 0 of 5 locked mousemoves with buttons 0; held button:
`buttons` 1 on every move, movement 100, then `buttons` 0 after the release and with no button
held. Without the switch, `unadjustedMovement` is refused (NotSupportedError) and the plain lock
follows acceleration.

#### c51: raw events after the lock ends

Asked for after Stage 2, and done after the zip was made, on the DCHECK build: no Release object
was built with the logging. A temporary `LOG(ERROR)` line for every XInput2 raw event at
`x11::Connection::DispatchEvent()` (`ui/gfx/x/connection.cc`), `out/Testing` rebuilt (20 steps),
then one run of a script of the build session (not in the repository): window B, a plain page,
stays open throughout; window A takes the raw lock three times; each interval moves the uinput
mouse (100,0) in 20 reports.

| Interval | Lock | Raw events at `x11::Connection` |
|---|---|---|
| locked, 1 | held | 60 for 20 motions: the slave pointer's own copy 20, the master pointer's 40 |
| after Esc | released | **0** |
| locked, 2 | held | 60 (20 and 40) |
| after Alt+Tab, focus in another application (xmessage) | released | **0** |
| locked, 3 | held | 60 (20 and 40) |
| after window A was closed, B still open | | **0** |

No raw event reached the connection outside the intervals either. The raw selection ends with the
lock in all three ways; while the lock is held each motion reaches the browser three times, the
slave pointer's copy that c51 counts and the master pointer's two (Stage 2), as c51's description
says. The logging was then removed: the file is back at its committed content (checked by
SHA-256) and its original time stamp, so the Release build made before stays up to date, and
`out/Testing` was rebuilt. Afterwards `ninja -n` has nothing to do in `out/Release` and in
`out/Testing`, neither `electron` binary contains the logging string, and dist.zip is unchanged
(same size and SHA-256).
