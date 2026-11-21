# Electron v45.4.1 KCC series: build and check results

Build of Electron **v45.4.1** (Chromium **156.0.8078.100**, V8 **15.6.75.57**) with the patch
series in this directory, on the machine described below. Raw logs are in
[`results/`](results/). Nothing here was tested in the game; see
[What this machine could not check](#what-this-machine-could-not-check).

> Status: in progress. Sections marked _pending_ are filled in as the stages complete.

## Machine (Stage 0)

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 (build 26200), x64 |
| CPU | QEMU Virtual CPU version 2.5+, **12 cores / 12 threads** (the brief assumed 24) |
| RAM | 32.0 GB; commit limit 34.0 GB (2 GB system-managed pagefile) |
| Disk | C: **98.0 GB free** at the start (the brief asks for ~250 GB). Enough here only because the Chromium 156 checkout, its git cache and a 52 GB `out/Release` from the v45.0.0-alpha.14 build already existed in `C:\electron` |
| GPU | **None.** Display adapters: Microsoft Remote Display Adapter, Microsoft Basic Display Adapter. Chromium reports `gpu_compositing: disabled_software`; WebGL runs on ANGLE D3D11 over WARP (`Microsoft Basic Render Driver`, a software rasteriser) |
| Session | RDP session `rdp-tcp#0`, Active (rendering tests need an active session: with a disconnected one rAF never runs) |
| Toolchain | VS 2022 Build Tools (`C:\BuildTools`), depot_tools (python3 3.11.8), Node.js 24.15.0 (Electron 45 needs >= 22.18.0) |

Consequences of the missing GPU, which apply to every result below:

- The display compositor runs the **software** output path. Frame-cap pacing, swap-ack
  release and the begin-frame source are the same code as with a GPU, but the swap itself
  is a software present, and frame rates are far lower than on a gaming machine.
- `DCompPresenter` is not used, so **c31 cannot be exercised** here.
- WebGL is real ANGLE/D3D11 code on WARP, so c21 and c30 run their actual code paths, but
  performance numbers from WARP say nothing about a real GPU.

## Source tree (Stage 0)

Existing checkout `C:\electron` (gclient root, `src/electron` unmanaged), moved from
v45.0.0-alpha.14 (Chromium 156.0.8077.0) to the **v45.4.1** tag and synced with
`gclient sync --with_branch_heads --with_tags --reset`
([log](results/stage0/sync_4541.log); 1 h). The sync could not fetch into the
existing Chromium git cache (two failed `git fetch`, no reason printed), so gclient
re-bootstrapped the cache from Google Storage (14.4 GiB); the "STALL DETECTED" lines in
the log are gsutil progress that does not end in newlines, not a stall.

| Check | Result |
|---|---|
| `src/electron/DEPS` `chromium_version` | `156.0.8078.100` |
| `src/chrome/VERSION` | 156.0.8078.100 |
| V8 (`v8/include/v8-version.h`) | 15.6.75.57 |
| Electron's own patches | 301 Chromium commits on `46876a0c2d` (156.0.8078.100), 37 V8 commits on the pinned `5e51e9c607` |
| Windows SDK required (`build/toolchain/win/setup_toolchain.py`) | 10.0.28000.0, installed |
| Electron 45 build docs | Node.js >= 22.18.0, VS 2022; nothing stricter than BUILD-GUIDE.md otherwise |

Base commits the series was applied on ([`results/stage0/base-commits.txt`](results/stage0/base-commits.txt)):

| Checkout | Base commit |
|---|---|
| `src` | `8add51604cf1b2b144d0d431649229d8a3066a3b` |
| `src/electron` | `deaded07eebdfe9a3737884933b1acbe65971f64` (v45.4.1) |
| `src/v8` | `94a69781b2f5c673c6579713f09af4b86311ad64` |

`apply.sh --check`: 23 ok, 0 failed; `apply.sh --commit`: 23 commits
([logs](results/stage0/)).

**refresh.sh did not round-trip byte for byte** (the README claimed it did): in this full
checkout git abbreviates blob ids to 13 hex digits, in the sparse checkout the drafts were
written in to 9, so every `index` line differed although no diff content did.
`refresh.sh` now passes `--full-index`, the 23 diffs were rewritten once with full ids
(content unchanged), and a second refresh reports 0 changed.

## Build configurations

### DCHECK build, `out/Testing` (Stages 1 and 2)

```
import("//electron/build/args/testing.gn")
use_remoteexec = false
use_reclient = false
symbol_level = 0
override_electron_version = "45.4.1"
```

`testing.gn` sets `is_debug = false`, `is_component_build = false`,
`is_official_build = false`, `dcheck_always_on = true`, `symbol_level = 1`. The only
change is `symbol_level = 0` (no debug info, to save disk and link time; code generation
is the same). No remote execution is available here. GN: 36,345 targets
([log](results/stage1/gn-gen-testing.log)).

| Pass | What | Steps | Time | Result |
|---|---|---|---|---|
| early 1 | the 30 object files the series touches, by name. `cmd.exe` ate the `^` of ninja's `file.cc^` syntax, so only the IDL/bindings and type-check steps ran | 124 | 14:40-14:42 | exit 0 ([log](results/stage1/build-early-1-typecheck-idl.log)) |
| early 2 | the same 30 objects named as `obj/....obj`; ninja builds their hard dependencies first | 36,289 | 14:49-22:53 (8 h 04 min) | exit 0 ([log](results/stage1/build-early-2-patched-objects.log)) |
| full | `autoninja -C out/Testing -k 0 electron` | 10,810 | 22:54-01:59 (3 h 06 min) | exit 0 ([log](results/stage1/build-full-testing.log)); `electron.exe` 395,855,360 bytes |

**All 23 diffs compiled as drafted. No fix was needed and there are no fixup
commits.** Chromium builds with `-Werror`, so this also means no compiler warnings in
the patched code. The early passes were there to put compile errors in the drafts first
(and they would have stopped there), not to save time; ninja's hard dependencies pulled
in most of the build anyway.

### Official build, `out/Release` (Stage 3)

_pending_

## Test harness

All of it is in [`test/`](../../test/). Each check is an Electron main script. PowerShell
drivers run it with the switches off and on and write a log and a JSON file per run.

| Script | Purpose |
|---|---|
| `cdp-test.js`, `run-ws-gate.ps1` | WebSocket-starvation gate (BUILD-GUIDE.md "Verification") |
| `frame-cap-test.js` + `frame-cap.html`, `run-frame-cap-gate.ps1` | Frame-cap gate: launch, runtime and heavy suites. Also the cpu (c60) and latency (c61) suites |
| `run-checks.ps1` | Every synthetic check, off vs on |
| `run-stage.ps1` | The Stage 2 / Stage 3 sequence on one binary, in parts that each fit in 2 h |
| `gpu-status.js` | GPU feature status and WebGL renderer, recorded with every stage |

The harness was changed during Stage 2. Each change fixed a case where the first version
gave the wrong answer on this machine. The first run's results are kept in
[`results/stage2-testing/run1-first-harness/`](results/stage2-testing/run1-first-harness/).

1. **A stock Electron DCHECK.** Every launch-time cap run died at startup on the DCHECK
   build: `base/feature_list.cc` "DCHECK failed: associate_params_result".
   - Electron initialises the feature list twice in the browser process:
     `ElectronMainDelegate::PreBrowserMain` and again in
     `ElectronBrowserMainParts::PostEarlyInitialization`. The field-trial registry survives
     in between, so a parameter given on the command line (`CustomFrameCap:fps/60`) is
     associated twice.
   - A DCHECK build stops at the second association; a release build only logs it.
   - This is stock Electron, not the series. A made-up feature name
     (`--enable-features=KccNoSuchFeature:x/1`) crashes the same way.
   - Fix: on the DCHECK build the frame-cap gate passes its list as `--kcc-features`, which
     the main script appends as `--enable-features` before the app is ready
     (`-FeaturesVia js`). That is also how a client normally sets switches. The Release
     build is tested with the plain command line, as BUILD-GUIDE.md describes.
2. **Caps the page cannot reach.** On the DCHECK build the WebGL page peaks at 85-118 fps
   here (433 on the Release control). The runtime suite still checked 144 after hide/show
   and resize and counted the misses as failures. It now never checks a cap the page
   cannot reach: it uses the largest caps it can (with 1.3x headroom, because the uncapped
   rate drifts during a run) and records each substitution as a `SKIP` line. The heavy
   suite checks a cap for accuracy only with 1.1x headroom.
3. **A noisy VM.** Identical consecutive runs of the same binary differ, with nothing else
   running:
   - 725 fps (interval sd 0.33 ms) one run, 450 fps (sd 1.56 ms) the next;
   - a busy-5-ms page shows frame p50 6.3 ms in one stretch and 8.2 ms (sd 1.8) in the
     next, tens of seconds each, whatever the switches.

   Everything except the page's own spin takes about 2.5x longer in those stretches. The
   guest cannot see why; the host is the likely cause. The responses:
   - A run that fails only on rate is run once more, and both attempts are reported.
     Crashes, DCHECKs, frozen windows (a measurement that timed out), runs without frames
     and missing result files are never re-run.
   - The heavy suite ("a cap above reach must not lose rate") runs 5 times per variant,
     interleaved with "off", and compares the best run of each, with medians reported
     alongside. The environment can only slow a run down, and a real cost of a switch
     lowers its best run too.
   - "`setFrameCap(0)` returns to uncapped" is compared with an uncapped window measured
     just before, as well as with the baseline from the start of the run.
4. **2D page where WebGL is too slow or too noisy.** On the DCHECK build, the c60 and c61
   checks and the heavy suite draw with a 2D canvas (`-CapPageMode 2d`). There the WebGL
   page cannot reach 144, so neither check's cap would bind. Its rate also varies by 30%
   between identical runs, against about 2% for the 2D page with the same per-frame spin.
   The cap code in viz does not depend on what the page draws. The Release build uses
   WebGL.
5. **c60 and c61 got quantitative verdicts.**
   - c60: VizCompositorThread must at least halve.
   - c61: BeginImplFrame to DrawAndSwap must be within 30% of one cap period with the
     switch off, and within 0.3 periods of the render time with it on.

## Release gates

_pending_

## Per patch

_pending_

## Dropped

_pending_

## What this machine could not check

- **Nothing was tested in the game.** No result here says anything about Krunker's frame
  rate, input feel or network behaviour.
- **macOS and Linux.** c32 (macOS) and c50/c51 (Linux/X11) are not part of a Windows
  build: their code sits in Mac- or X11-only files or under `BUILDFLAG(IS_MAC)`. They were
  desk-checked against this tree (identifiers, signatures, includes, deps; see
  [Per patch](#per-patch)), not compiled. The macOS and Linux halves of c12 and c15, and
  the non-Windows paths of c60 and c61, were not compiled either. Each needs a build on
  its own OS.
- **No GPU.** Software compositing only (see [Machine](#machine-stage-0)):
  - c31 (`DCompPresenter`) never runs;
  - c30 and c21 run on WARP, so they show correctness, not speed;
  - the frame-cap results are for the software present path. They say nothing about
    flip-model swap chains, real vsync or a GPU-bound frame.
- **Real mice.** c12-c15 were driven by `SendInput` relative packets at up to 500 Hz.
  That exercises the real `WM_INPUT` path with exact counts, but not an 8 kHz mouse, the
  CPU cost of one, or the "feel" claims.
- **Long sessions.** Every run is seconds to minutes long. Leaks, drift over hours and
  rare races were not looked for.
- **The Krunker-trained PGO profile** was not used: the Release build uses Electron's own
  profiles from `release.gn`.
