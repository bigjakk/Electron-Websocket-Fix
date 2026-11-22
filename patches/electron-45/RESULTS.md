# Electron v45.4.1 KCC series: build and check results

Build of Electron **v45.4.1** (Chromium **156.0.8078.100**, V8 **15.6.75.57**) with the patch
series in this directory, on the machine described below. Raw logs are in
[`results/`](results/). Nothing here was tested in the game; see
[What this machine could not check](#what-this-machine-could-not-check).

> **Status: complete, 2026-11-21.** 22 patches. c61 was dropped because its premise was false
> ([Dropped](#dropped)).
> - **Builds:** every draft that builds on Windows compiled unchanged, in a DCHECK build and in
>   the official Release build. That build produced the dist.zip
>   ([Official build](#official-build-outrelease-stage-3)).
> - **Gates:** both release gates pass on the Release build, with the switches off and on. On
>   the DCHECK build the WebSocket gate passed only on re-runs. On the Release build, c60's
>   "cap above reach" verdict rests on a direct test, because the gate's own rule was fooled
>   by the VM ([Stage 3](#stage-3-release-build-22-patches-the-distzip)).
> - **Checks:** every synthetic check passes on both builds except c31, which needs a GPU.
> - **Not compiled:** c32, c50 and c51 (macOS and Linux only).
> - **In the game:** nothing was tested.

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

```
import("//electron/build/args/release.gn")
is_official_build = true
use_remoteexec = false
use_reclient = false

# src/electron carries the series' local commits, so the version would
# otherwise come out of git describe as 45.4.1-<n>-g<sha>.
override_electron_version = "45.4.1"
```

The Release args from BUILD-GUIDE.md, plus the version override the DCHECK build also uses
([`args.gn`](results/stage3-release/args.gn), driver
[`build_release.ps1`](results/stage3-release/build_release.ps1)). Effective values from
`gn args out/Release --list`:

- `is_official_build = true`, `is_debug = false`, `is_component_build = false`,
  `dcheck_always_on = false`;
- `use_thin_lto = true`, `thin_lto_enable_optimizations = true`, `symbol_level = 2`;
- `chrome_pgo_phase = 2` with **Electron's own profiles**, which come with the Electron
  checkout. Compiles use
  `-fprofile-use=electron/build/pgo_profiles/electron-win-x64-1794713269-6bfc23bf15.profdata`;
  V8's builtins use `electron-v8-builtins.profile`. The Krunker-trained profile was not used:
  the brief keeps it for when you ask;
- `is_component_ffmpeg = true`, `proprietary_codecs = true`.

GN: 36,314 targets from 5,105 files ([log](results/stage3-release/gn-gen-release.log)).
The build reused the `out/Release` directory of the v45.0.0-alpha.14 build. The tree had
moved to another Chromium patch level, so nearly everything was rebuilt.

| Pass | What | Steps | Time | Result |
|---|---|---|---|---|
| gen | `gn gen out/Release` | | 05:00-05:01 | exit 0 |
| full | `autoninja -C out/Release -k 0 electron` | 44,575 | 05:05-17:01 (11 h 55 min) | exit 0 ([log](results/stage3-release/build-full-release.log)); `electron.exe` 249,946,624 bytes |
| zip | `autoninja -C out/Release electron:electron_dist_zip` | 2 | 17:02-17:04 | exit 0 ([log](results/stage3-release/build-dist-zip-release.log)) |

**The 22 diffs compiled in the official configuration without a change** (no fixup
commits). The log has no compiler warnings. Its one warning is the linker's note that the
ThinLTO cache (9.1 GB) had outgrown its 8.7 GB limit and was pruned.

**dist.zip**

| | |
|---|---|
| Path | `C:\electron\src\out\Release\dist.zip`. Copy that a later build will not overwrite: `C:\electron\electron-v45.4.1-kcc-series-windows-x64.zip` |
| Size | 158,245,796 bytes; 73 files, 374,152,828 bytes unpacked |
| SHA-256 | `d05451cb2e2b44b58f3ed822813638ddfd97e118dfc7ca8e5ee8df043e644e74` |
| `electron.exe` | 249,946,624 bytes, SHA-256 `aa0d16f1cbf67807b119bcd3a7f9f3e7463af8ee888d03ffd2f77e16bfd2caf5`; `--version` prints `v45.4.1`, file version 45.4.1 |
| Layout | The same top-level files as the v45.0.0-alpha.14 zip. Neither zip contains `libEGL.dll` or `libGLESv2.dll`, which `out/Release` also holds. WebGL runs from the unpacked zip (Stage 3 gates) |
| Built from | the 22 series commits on the base commits above; `apply.sh --check --base` confirms that base plus diffs equals the built trees in all three checkouts |

## Test harness

All of it is in [`test/`](../../test/). Each check is an Electron main script. PowerShell
drivers run it with the switches off and on and write a log and a JSON file per run.

| Script | Purpose |
|---|---|
| `cdp-test.js`, `run-ws-gate.ps1` | WebSocket-starvation gate (BUILD-GUIDE.md "Verification") |
| `frame-cap-test.js` + `frame-cap.html`, `run-frame-cap-gate.ps1` | Frame-cap gate: launch, runtime and heavy suites. Also the cpu (c60) and latency (c61, then input age) suites |
| `perfetto-trace.js` | Reads the Perfetto protobuf traces Electron 45 writes (see 6 below) |
| `run-checks.ps1` | Every synthetic check, off vs on |
| `run-stage.ps1` | The Stage 2 / Stage 3 sequence on one binary, in parts that each fit in 2 h |
| `gpu-status.js` | GPU feature status and WebGL renderer, recorded with every stage |
| `webgl-startup-test.js`, `run-webgl-startup.ps1` | Does the WebGL page's context survive startup? Repeated per variant (see 7 below) |
| `cap-toggle-test.js`, `run-cap-toggle.ps1` | Does setting a cap above reach cost rate? Capped windows against their uncapped neighbours in one launch (see 8 below) |

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
6. **Electron 45 writes Perfetto protobuf traces.** `contentTracing` recordings switched
   from JSON to the Perfetto protobuf format between v45.0.0-alpha.14 and v45.0.0
   (electron/electron `7762d32d1c`, a breaking change in `docs/api/content-tracing.md`: "The
   legacy JSON format is no longer supported"). The trace-based checks (v01, c20/c30/c31,
   c61) had been written and dry-run against alpha.14's JSON, so on 45.4.1 they stopped at
   `JSON.parse`. [`test/perfetto-trace.js`](../../test/perfetto-trace.js) now decodes the
   TrackEvent packets into the legacy event shape, with field numbers taken from the
   `.proto` files in this Chromium checkout; nothing was downloaded. It reads a JSON trace
   too.

   Checked on a real trace from this build:
   - 70,126 events, three processes, an 8.4 s span for the 8 s page run, no negative
     durations;
   - c20's stock counts match the alpha.14 control: RecordMetrics about once per 100
     frames, GetVSyncParameters about once per frame.

   The first, interrupted checks run is kept in
   [`results/stage2-testing/checks-run1-json-traces/`](results/stage2-testing/checks-run1-json-traces/).
7. **A WebGL context lost at load, in stock Electron too.** In Stage 3 the first attempt of
   one frame-cap run (every switch on, WebGL page) failed.
   - The page's WebGL2 context was lost while it loaded (`CONTEXT_LOST_WEBGL: loseContext:
     context lost`, within 100 ms of the load). No GPU process crashed.
   - The page then drew nothing, so no cap had frames to hold. rAF ran at about 58/s whatever
     the cap, and the run read as six cap failures. Its retry passed.

   [`test/webgl-startup-test.js`](../../test/webgl-startup-test.js) launches that page and
   reports whether its context survived. [`run-webgl-startup.ps1`](../../test/run-webgl-startup.ps1)
   repeats it per variant, interleaved
   ([`results/stage3-release/webgl-startup-*/`](results/stage3-release/)):

   | Binary | Switches | Launches | Context lost at load |
   |---|---|---|---|
   | v45.0.0-alpha.14 control (none of the drafts) | stock | 30 | 2 |
   | 45.4.1 dist.zip | every switch off | 59 | 1 |
   | 45.4.1 dist.zip | c30 (`KccLabelTexturesOnce`) alone | 58 | 3 |
   | 45.4.1 dist.zip | every switch on (with or without the JS flag) | 7 | 1 |
   | 45.4.1 dist.zip | each other switch alone, or the JS flag alone | 45 | 0 |
   | 45.4.1 dist.zip, `--no-turbo-fast-api-calls` (c21's fast calls off) | off / c30 alone | 30 / 30 | 2 / 1 |

   So it is not the series. It happens on the control, which has none of the drafts, and with
   c21's fast calls off. c30's 3 of 58 against 1 of 59 with the switches off is within chance;
   the control lost 2 of 30. A first exploration had pointed at c30 (1 of 3 launches, every
   other switch 0 of 3) before the larger runs. The cause was not found here: the runs with
   the GPU process logging to stderr had no loss to show.

   The harness now reports it as what it is:
   - frame-cap-test.js checks the context after load; a lost one is a single failing check
     ("page WebGL context alive at load") and nothing is measured. The second view of the
     runtime suite gets the same check.
   - Such a run is retried like a rate-only miss, and both attempts are listed.
   - The canvas page and the fast-API page record `contextLost`; c30's verdict requires it
     false.
8. **The heavy suite's best-of-5 rule can be fooled by the VM's state changes.** On the
   Release build it failed c60 twice, though c60's medians did not move. A cap above reach is
   now also tested directly with [`test/cap-toggle-test.js`](../../test/cap-toggle-test.js)
   (driver `run-cap-toggle.ps1`), which alternates no cap and a cap above reach in one launch.
   See [Stage 3](#stage-3-release-build-22-patches-the-distzip) for both.
9. **Overwritten logs.** The cap-switch gate (`run-stage.ps1 -Part cap-switches`) wrote its
   "off" heavy runs into the gates part's folder, under the same file names.
   - **Stage 3:** the gates part's logs were restored from git, and the cap-switch run's files
     moved to [`cap-switches/`](results/stage3-release/cap-switches/). `run-stage.ps1` now
     writes there.
   - **Stage 2:** nothing was lost; the gates part's heavy logs had been moved to
     [`heavy-median3/`](results/stage2-testing/heavy-median3/) before the cap-switch run.
     So the `off-heavy-*` logs at the top of `stage2-testing/` are the cap-switch run's
     (03:33-04:25). The heavy lines of the `summary-off-all.txt` beside them belong to the
     logs in `heavy-median3/`; that median-of-3 comparison was replaced by the best-of-5
     rerun in [`heavy/`](results/stage2-testing/heavy/), which the Stage 2 table uses.

## Release gates

Both gates as the brief defines them, with every run's log in `results/`. "Switches on" means
every switch of the series (README "Everything on") plus
`--js-flags=--cppheap-max-incremental-sweep-duration-ms=1`. The frame-cap runs use
`--disable-frame-rate-limit --disable-gpu-vsync`, and the cap is never combined with
`CustomMaxPendingFrames:count/2`.

### Stage 2: DCHECK build (23 patches, with c61)

Results in [`results/stage2-testing/`](results/stage2-testing/) (`stage-summary.txt`,
`summary-*.txt`, `ws-gate-*.txt`). GPU status: `gpu_compositing: disabled_software`; WebGL2
on ANGLE D3D11 over WARP. Features were passed through the main script (`-FeaturesVia js`)
because of the stock DCHECK described under [Test harness](#test-harness).

**WebSocket gate** (`cdp-test.js`, 12 s of CDP mouse events at ~1,550/s, 2 runs per setting):

| Switches | Run | p99 | max | > 50 ms | Result |
|---|---|---|---|---|---|
| off | 1 | 36.8 ms, re-run 34.1 | 70.7 ms, re-run 40.8 | 2/670, re-run 0/695 | pass on the re-run |
| off | 2 | 36.4 ms, re-run 35.6 | 61.2 ms, re-run 45.1 | 1/684, re-run 0/648 | pass on the re-run |
| on | 1 | 32.2 ms | 45.7 ms | 0/722 | pass |
| on | 2 | 32.8 ms | 35.0 ms | 0/716 | pass |

**The DCHECK build does not meet the strict criterion reliably.**
- Every one of its 19 attempts had p99 31.9-38.8 ms, the patched signature. The brief gives
  an unpatched build p99 near 100 ms with 5-9% of messages over 50 ms.
- But 7 of its 15 attempts with the switches off had one or two messages (of ~690) at 50-71
  ms. That counts the first run, the gate above and a 6-run repeat in
  [`ws-repeat/`](results/stage2-testing/ws-repeat/), where one run failed both attempts.
- With the switches on, 0 of 4 attempts had any.
- The v45.0.0-alpha.14 Release control, which has ws-priority too, passed 6 of 6 on this
  machine (p99 31.9-32.5 ms, max 33.0-37.5 ms;
  [`control-alpha14/ws-gate/`](results/control-alpha14/ws-gate/)).

So the overshoot is the DCHECK build's extra cost on this VM, and the Release gate below is
the verdict.

**Frame-cap gate**: every launch, runtime and second-view check passed for every switch
setting. The table gives the measured rate over each 10 s window:

| Switches | Launch cap 60 / 144 / 240 (at launch, after hide/show, after resize, re-cap) | setFrameCap 60 / 144 / 240 (2D page) | Uncapped (2D) |
|---|---|---|---|
| off | 60.0-60.1 / 144.0-144.2 / 239.6-240.0 | 60.0 / 144.0 / 240.0 | 722 |
| all | 60.0 / 144.0 / 238.7-240.0 | 60.1 / 144.0 / 239.2 | 504 |
| c60 | 60.0 / 144.0 / 239.6-240.1 | 60.0 / 144.0 / 240.0 | 498 |
| c61 | 60.0-60.1 / 143.9-144.1 / 238.7-240.0 | 60.0 / 144.0 / 239.0 | 299 |
| c60 + c61 | 59.9-60.0 / 143.4-144.0 / 238.7-240.0 | 60.0 / 144.0 / 239.6 | 473 |

The uncapped rates differ with the VM's noise, not with the switches.

The other checks passed for every setting (2D page):
- hide/show and resize at 144: 144.0;
- a change of N, measured over the 2 s right after the call: within 0.9%;
- `setFrameCap(0)`: back to 98-111% of the uncapped rate measured just before;
- a second animating view at 144 and 60: 143.7-144.0 and 60.0-60.1.

The WebGL page reaches only 98-118 fps on this build, so its runtime suite was checked at the
caps it can reach: 72/45/60, or 90/72/60, and 45 after a resize. All 10 of its checks passed
for every setting.

A cap above reach (heavy suite, 2D page with 5 or 3 ms of script per frame, best of 5 runs
interleaved with the switches off):

| Switches | busy 5 ms: cap 1000 / 240 / 144 vs off | busy 3 ms: cap 1000 / 240 / 144 vs off |
|---|---|---|
| all | +1.2 / +0.5 / +0.0 % | +1.3 / +0.8 / +0.0 % |
| c60 | +0.5 / +1.2 / +0.1 % | +1.8 / +1.6 / +0.0 % |
| c61 | +0.7 / +1.3 / +0.1 % | +1.9 / +1.7 / -0.1 % |
| c60 + c61 | +0.1 / +0.6 / +0.1 % | +1.5 / +1.4 / +0.0 % |

No switch loses rate (the limit is -3%). An observation outside the gate: with a cap above
reach, the VM's slow stretches hit about 80% of the 10 s windows with the switches off. With
c60 on they hit 35-50%, and with c61 alone 60%. That fits c60's premise: the stock cap keeps
the viz thread spinning through every hold, which on a host-contended VM slows the rest.

### Stage 3: Release build (22 patches, the dist.zip)

Results in [`results/stage3-release/`](results/stage3-release/) (`stage-summary.txt`,
`summary-*.txt`, `ws-gate-*.txt`, every run's log and JSON). The gate with c60's switch
alone is in [`cap-switches/`](results/stage3-release/cap-switches/), the synthetic checks in
[`checks/`](results/stage3-release/checks/).

- **Binary:** `dist.zip` unpacked into `C:\electron\dist-45.4.1-kcc\`. Its `electron.exe` is
  byte-identical to `out/Release/electron.exe`, so the runs also show that the zip is
  complete.
- **Switches** go on the command line, as BUILD-GUIDE.md describes.
- **Pages:** the WebGL page for the runtime, heavy and c60 checks. The 2D page is used for the
  launch suite and the second runtime suite, as in Stage 2.
- **GPU status and versions** are as in Stage 2: `gpu_compositing: disabled_software`, WebGL2
  on ANGLE D3D11 over WARP; Electron 45.4.1, Chromium 156.0.8078.100, V8
  15.6.75.57-electron.d384e85dffdbe2dd, Node 24.22.3.

**WebSocket gate**: all four runs pass the strict criterion on the first attempt.

| Switches | Run | p99 | max | > 50 ms | Result |
|---|---|---|---|---|---|
| off | 1 | 32.5 ms | 33.9 ms | 0/724 | pass |
| off | 2 | 32.1 ms | 43.1 ms | 0/725 | pass |
| on | 1 | 32.6 ms | 35.9 ms | 0/731 | pass |
| on | 2 | 33.5 ms | 36.8 ms | 0/698 | pass |

As the alpha.14 Release control predicted, the DCHECK build's occasional 50-71 ms message is
gone.

**Frame-cap gate**: every launch, runtime and second-view check passed for every switch
setting. The table gives the measured rate over each 10 s window:

| Switches | Launch cap 60 / 144 / 240 (at launch, after hide/show, after resize, re-cap) | setFrameCap 60 / 144 / 240: 2D page; WebGL page | Uncapped: 2D / WebGL |
|---|---|---|---|
| off | 60.00 / 143.99-144.02 / 240.03-240.04 | 60.00 / 144.01 / 240.04; 60.01 / 144.01 / 240.04 | 1247 / 369 |
| all | 60.00 / 144.00-144.01 / 240.01-240.04 | 60.00 / 144.01 / 240.04; 60.00 / 144.01 / 240.00 | 1209 / 373 |
| c60 | 60.00 / 144.00-144.02 / 240.03-240.04 | 60.00 / 144.00 / 240.04; 60.01 / 144.01 / 240.03 | 965 / 376 |

The other checks passed on both pages for every setting:
- hide/show and resize at 144: 144.00-144.01;
- a change of N, measured over the 2 s right after the call: within 0.1% of the new cap
  (worst 143.90 for 144 and 239.77 for 240);
- `setFrameCap(0)`: back to 0.98-1.43x the uncapped rate measured just before;
- a second animating view at 144 and 60: 144.01 and 60.00 in both views.

Unlike Stage 2, the WebGL page reaches 316-389 fps here, so every WebGL check ran at its own
cap.

Two first attempts failed, both because the WebGL page's context was lost at load. That is
stock behaviour on this machine; see [Test harness](#test-harness), item 7. The first was
`all-runtime-webgl`, which the old harness read as six cap failures. The second was
`precise-runtime-webgl`, which the new harness reported as "page WebGL context alive at
load". Both retries passed 14/14.

**A cap above reach** (heavy suite, WebGL page with 5 or 3 ms of script per frame, best of 5
runs interleaved with the switches off):

| Switches | busy 5 ms: cap 1000 / 240 / 144 vs off | busy 3 ms: cap 1000 / 240 / 144 vs off |
|---|---|---|
| all | +0.4 / -1.2 / +0.3 % | -0.2 / +1.7 / +0.0 % |
| c60, first comparison ([`cap-switches/`](results/stage3-release/cap-switches/)) | **-24.0 / -23.8 / -23.2 %** (medians +1.4 / +0.3 / -0.3 %) | +19.1 / +29.2 / +0.0 % (medians +0.1 / -0.6 / +0.0 %) |
| c60, re-run ([`heavy-retry-precise/`](results/stage3-release/heavy-retry-precise/)) | **-17.2 / -21.8 / -21.4 %** (medians -0.1 / +0.4 / -0.3 %) | **-20.7 / -24.8** / +0.0 % (medians -1.0 / -0.4 / +0.0 %) |

**c60 failed this rule twice while its medians did not move, and a direct test shows the
rule, not c60, was wrong here.**
- The rule compares the best of 5 runs. It assumes the machine's state does not depend on the
  switch, and that a run's best shows what the switch allows.
- On this VM the best runs are the ones it spends in its fast state. At busy 5 ms that means
  frame intervals of 6.8 ms with a spread of 0.13-0.22 ms, against 9.0-9.2 ms and 0.8-1.4 ms
  otherwise. Only 1 to 4 of each 10 runs were in it, in whole or in part, and unevenly. At
  busy 5 ms the runs that stayed fast all fell to the switches off. At busy 3 ms one fell to
  c60 (+19 / +29 %) and one to off.
- Every heavy run measures its uncapped window first and the capped ones after it. So a run
  that leaves the fast state part-way looks like a cost of the cap.

[`test/cap-toggle-test.js`](../../test/cap-toggle-test.js) measures the requirement directly.
In one launch it alternates `setFrameCap(0)` with a cap above reach (1000, then 240) in 4 s
windows, and compares each capped window with the uncapped windows just before and after it
([`cap-toggle-precise/`](results/stage3-release/cap-toggle-precise/); 8 cycles per launch,
launches interleaved):

| Switches | busy 5 ms (4 launches, 32 pairs) | busy 3 ms (2 launches, 16 pairs) |
|---|---|---|
| off | median +0.3 %, mean +0.9 %, worst -2.7 % | median +0.0 %, mean +0.2 %, worst -3.7 % |
| c60 | median +0.5 %, mean +0.3 %, worst -2.4 % | median -0.4 %, mean -0.8 %, worst -4.1 % |

- Three launches started in the fast state, one with c60 and two with the switches off.
- The c60 launch kept 144-147 fps through six capped windows.
- All three left the fast state 50-60 s in: the c60 launch during a capped window, the two off
  launches during uncapped ones. The state changes on its own, whatever the cap and the switch.

**Verdict for c60: pass.** It rests on this test, not on the heavy rule: setting a cap above
reach costs c60 no rate here. "Every switch on", which includes c60, also passed the heavy rule
as it stands.

**Synthetic checks** ([`checks/`](results/stage3-release/checks/), each with its switch off and
on): **all pass**. c31 is not exercised, as in Stage 2. The results match Stage 2's:

| Check | Stage 2, DCHECK build | Stage 3, dist.zip |
|---|---|---|
| c10 (ungated back-port) | keyup A arrives via sendInputEvent and CDP | the same |
| c11 | re-lock after Esc: off SecurityError, on locked | the same (45 ms after Esc) |
| c12 | off (352,112) accelerated, on (200,120) raw | off (352,113), on (200,120) |
| c13 | motion in wheel packets: off (0,0), on (200,0) | the same |
| c14 | what the page sees is the same as with the switch off | the same |
| c15 | coalesced / predicted: on 1 / 0, off 16 / 10 | the same |
| e10 | 10/10 checks off and on | the same |
| c20 | RecordMetrics: off 7, on 0 | off 10, on 0 |
| c21 | the same GL errors and pixels with fast calls, without, and with every switch | the same; loop 6.5 s with fast calls, 6.3 s without (WARP) |
| v01 | sweep slices p50 5.10 / 1.15 / 2.15 ms (stock, flag 1, flag 2) | 5.12 / 1.11 / 2.09 ms |
| c30 | glError 0 | glError 0, WebGL context not lost |
| c31 | not exercised (0 calls) | not exercised (0 calls) |
| c40 | batch time while suspended: on 0.50-1.02x, off 12-13x | on 0.47-1.00x, off 14-15x |
| c41 | four renders identical | four renders identical |
| c60 | VizCompositorThread at a 144 cap, 2D page: 88 → 16 % of a core | WebGL page: 98.8 → 41.5 % |
| input age at a 144 cap (information) | main frame start to DrawAndSwap, 2D page: 6.6 ms (busy 0), 13.5 ms (busy 3) | WebGL page: 13.7 ms at busy 0 and 3, as on the alpha.14 control |

## Per patch

"Compiled" is the Windows build of this machine: the DCHECK build in Stage 1, the official
build in Stage 3. **No patch needed a change to compile** (no fixup commits). The checks are
in [`test/`](../../test/) and run each binary with the patch's switch off and on. Stock
behaviour comes from the v45.0.0-alpha.14 control
([`results/control-alpha14/`](results/control-alpha14/)), which has only the ported patches.
Stage 2 outcomes are on the DCHECK build; the "Release" column has the Stage 3 outcomes on the
official build (the unpacked dist.zip).

| Patch | Compiled | Changed | Check (Stage 2, DCHECK) | Release | Not tested here |
|---|---|---|---|---|---|
| c01 `ws-priority` | yes | nothing | WS gate: p99 32-39 ms everywhere; strict pass on re-runs (see [Release gates](#release-gates)) | WS gate off and on: p99 32.1-33.5 ms, 0 messages over 50 ms, first attempts: **pass** | in-game network behaviour |
| c02 `frame-pacing` | yes | nothing | frame-cap gate (uncapped and capped rates) | frame-cap gate: **pass** | `CustomMaxPendingFrames:count/N` values |
| c03 `frame-cap` | yes | nothing | frame-cap gate: launch and runtime caps 60/144/240, hide/show, resize, change of N, uncap, second view, all within 1%: **pass** | frame-cap gate, 2D and WebGL pages: every cap within 0.1%: **pass** | GPU swap chains, real vsync |
| e01 `frame-cap-set-frame-cap` | yes | nothing | `win.setFrameCap` drives the runtime suites: **pass** | drives the runtime suites: **pass** | |
| c10 `keyup-after-handled-keydown` | yes | nothing | keyup A reaches the page after a prevented key, via sendInputEvent and CDP: **pass** (stock: lost) | the same: **pass** | real keyboards, IME |
| c11 `pointer-lock-esc-cooldown` | yes | nothing | re-lock ~44 ms after a scripted Esc: off refused (cooldown), on locked; controls pass: **pass** | the same (re-lock 45 ms after Esc): **pass** | a physical Esc key |
| c12 `pin-raw-pointer-lock` | yes (Windows half) | nothing | option-less re-request on a raw lock: off (352,112) accelerated, on (200,120) raw: **pass** | off (352,113), on (200,120): **pass** | whether the client triggers it; macOS |
| c13 `raw-input-keep-wheel-motion` | yes | nothing | motion in wheel packets: off (0,0), on (200,0); wheel deltas equal: **pass** | the same: **pass** | real mice |
| c14 `raw-input-fast-path` | yes | nothing | same page-visible results as off: **pass** | the same: **pass** | the cost it saves |
| c15 `lean-locked-mouse-move` | yes (Windows half) | nothing | raw moves: coalesced 1 / predicted 0 (off: 16 / 10), sums unchanged: **pass** | the same: **pass** | the cost it saves; macOS |
| e10 `skip-unobserved-input-emits` | yes (JS bundle rebuilt) | nothing | 10/10 emit checks off and on, preventDefault still works: **pass** | the same: **pass** | the cost it saves |
| c20 `skip-canvas-perf-sampling` | yes | nothing | RecordMetrics slices off 7, on 0: **pass** | RecordMetrics off 10, on 0: **pass** | the spike it removes |
| c21 `webgl-fast-api-calls` | yes (bindings rebuilt) | nothing | identical GL errors and pixels with fast calls, without, and with every switch: **pass** | the same: **pass** | speed on a GPU |
| v01 `cppgc-sweep-slice` | yes | nothing | flag listed; slices carry max_duration_ms 5 / 1 / 2 as set, p50 5.10 / 1.15 / 2.15 ms: **pass** | slices as set, p50 5.12 / 1.11 / 2.09 ms: **pass** | effect on frame times |
| c30 `label-textures-once` | yes | nothing | texture page runs with the switch, glError 0, no DCHECK: **pass** | glError 0, context not lost: **pass** (a context lost at page load is stock behaviour here: [Test harness](#test-harness) 7) | the D3D11 cost (no GPU) |
| c31 `cache-vsync-interval` | yes | nothing | **not exercised**: no DCompPresenter without a GPU (0 calls off and on); runs with the switch on | **not exercised** (0 calls) | everything it does |
| c32 `mac-gpu-backpressure-poll` | **no** (macOS only) | nothing | desk-checked against the tree: nothing would fail | n/a | everything |
| c40 `audioparam-coalesce` | yes | nothing | batch time while suspended flat with the switch (0.50-1.02x), off 12-13x: **pass** | on 0.47-1.00x, off 14-15x: **pass** | whether Krunker hits it |
| c41 `hrtf-panner-krate-angles` | yes | nothing | 4 renders off/on identical sample for sample: **pass** | the same: **pass** | the cost it saves |
| c50 `x11-allow-unredirect` | **no** (Linux only) | nothing | desk-checked: nothing would fail | n/a | everything |
| c51 `x11-raw-mouse` | **no** (Linux only) | description only (a desk-check found a minor logic bug, recorded) | desk-checked: nothing would fail | n/a | everything |
| c60 `frame-cap-precise-release` | yes | nothing | frame-cap gate with it on: **pass**; VizCompositorThread at a 144 cap 88% → 16% of a core: **pass** | cap checks **pass**. The heavy suite's best-of-5 rule failed twice on the VM's state changes; the direct alternating test found no cost: **pass**. VizCompositorThread at 144, WebGL page: 98.8% → 41.5% | GPU swap chains, real vsync |
| c61 `frame-cap-late-latch` | yes | **dropped** | gate passed, but input age unchanged (6.56 → 6.56 ms): premise false, see [Dropped](#dropped) | not in the build | |

Every drafted diff's description now ends with a "Build and check status" block saying the
same. The "Not verified" notes written before the build are kept for the caveats they list.

## Dropped

### c61 `frame-cap-late-latch` (`KccFrameCapLateLatch`): premise false

**What happened.** Dropped on 2026-11-21 after its synthetic check on the Stage 2 build:
- the commit was reverted in `src` (`885c926e4b3c6`, which restores exactly the tree of c60's
  commit);
- the diff and its `series.txt` line were deleted;
- refresh.sh then reported 0 changed for the remaining 22 diffs, and `apply.sh --check
  --base` reported 22 ok with all three trees equal to HEAD.

The Stage 2 results with the switch on are kept as the record: `latch-*` / `both-*` in
[`results/stage2-testing/`](results/stage2-testing/) and `c61-*` in
[`results/stage2-testing/checks/`](results/stage2-testing/checks/).

**What c61 does.** Under a cap, viz withholds BeginFrames from a renderer's frame sink while
the sink has an undrawn frame and while the GPU is busy. The renderer is then meant to start
its frame at the swap-ack release, and the display to draw that frame as soon as it arrives:
input r old instead of one cap period old.

**Why it cannot work.** c61 acts only on `BackToBackBeginFrameSource`, i.e. with
`--disable-frame-rate-limit`. In exactly that mode blink gives every renderer its own synthetic
`BackToBackBeginFrameSource`:
- `third_party/blink/renderer/platform/widget/widget_base.cc`: "In disable frame rate limit
  mode, also let the renderer tick as fast as it can";
- `AsyncLayerTreeFrameSink` then hands cc that source instead of viz's BeginFrames.

So the renderer does not wait for viz's BeginFrame. It starts its next frame as soon as its
previous frame is acked, and that ack comes when the display draws, at the release. The
renderer's new frame then arrives while that draw's swap is pending ("Swap throttled") and
waits for the next release, the stock one-frame queue the patch set out to remove. Making
it work needs another mechanism, for example holding the renderer's frame ack until the ack
release, or having renderers use viz BeginFrames while a cap is set. That is a redesign, not
a contained fix.

**What was measured.** Stage 2 build, 2D page, 144 cap, `--disable-frame-rate-limit
--disable-gpu-vsync`, traces decoded with `test/perfetto-trace.js`:

| | switch off | switch on |
|---|---|---|
| main-frame start to `Display::DrawAndSwap` (input age), idle page, p50 | 6.56 ms | 6.56 ms |
| BeginImplFrame to DrawAndSwap, idle page, p50 | 11.05 ms | 10.99 ms |
| same, 3 ms script per frame, p50 (p10) | 12.90 ms (11.34) | 11.41 ms (6.14) |
| viz `SendBeginFrameDecision` for the renderer's sink | 579 x `SendFrameTiming` | 558 x `HoldUntilFrameAck`, 12 x `SendFrameTiming` |
| renderer BeginImplFrames in the same run | 579 | 570 (from its own source) |
| 240 cap, launch and runtime suites | 239.6-240.0 fps | 238.7-239.4 fps |

The patch engaged, its hold fired on nearly every BeginFrame, and input age did not change.
The premise about the stock code is right: a frame's input is about one cap period old (0.95
periods) with an idle page, and about two periods (13.5 ms) with 3 ms of script per frame.

In a trace with the switch on, the cycle per period is:
1. The release; viz holds the renderer's BeginFrame (`HoldUntilFrameAck`).
2. The display draws the renderer's queued frame, which is 6.4 ms old.
3. The draw's ack unblocks the renderer's next main frame, about 0.3 ms later.
4. The renderer submits 0.4 ms after that, its next BeginImplFrame comes from its own
   `DelayBasedTimeSource`, and the new frame waits behind the pending swap.

No crash, DCHECK or freeze came from c61. With it on, the frame-cap gate passed (launch
60/144/240, runtime, second view, heavy suite best of 5 within -0.1..+1.9% of off), and the
cap stayed within the 1% tolerance. In one extra latency run, though, the 144 cap read 141.5
fps (-1.8%).

## What this machine could not check

- **Nothing was tested in the game.** No result here says anything about Krunker's frame
  rate, input feel or network behaviour.
- **macOS and Linux.** c32 (macOS) and c50/c51 (Linux/X11) are not part of a Windows
  build: their code sits in Mac- or X11-only files or under `BUILDFLAG(IS_MAC)`. They were
  desk-checked against this tree (identifiers, signatures, includes, deps; see
  [Per patch](#per-patch)), not compiled. The macOS and Linux halves of c12 and c15, and
  the non-Windows paths of c60, were not compiled either. Each needs a build on
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
- **This VM's own behaviour.**
  - Its speed switches between a fast and a slow state that each last tens of seconds,
    whatever the switches. In the slow one, everything outside the page's own script takes
    2.3-2.5x longer.
  - So rate comparisons here are interleaved and repeated. For c60's "cap above reach", the
    comparison was replaced by a direct alternating test.
  - It also loses the WebGL context at page load in about 1 launch in 30, stock Electron
    included ([Test harness](#test-harness), item 7).
  - A real machine may show differences that this noise hides.
- **The Krunker-trained PGO profile** was not used: the Release build uses Electron's own
  profiles from `release.gn`.
