# Electron v45.4.1 KCC series: build and check results

> **These results are for the 22-patch series.** Eleven of those patches were removed on
> 2026-11-26; the reasons are in [README.md](README.md#removed-on-2026-11-26). The eleven
> kept diffs are unchanged, and the lean set has not been built as a set yet. Sections on a
> removed patch are kept as the record behind that decision; the test drivers and pages of
> the removed patches were removed with them, so some files named below no longer exist.

> **Correction, 2026-11-26: the Windows WebSocket gate's "switches on" runs.** Until that day
> `test/run-ws-gate.ps1` joined the last switch and the `--js-flags` value into one argument
> (`...KccFrameCapPreciseRelease--js-flags=...`; the first line of every `ws-gate-on-*.log`
> under `results/` shows it). In every Windows "switches on" WebSocket gate run recorded
> here, `KccFrameCapPreciseRelease` and the V8 flag were therefore not in effect; the other
> switches were. The frame-cap gate, the checks, the startup test and the in-game harness
> built their arguments correctly, and the macOS and Linux drivers never had the fault.

Build of Electron **v45.4.1** (Chromium **156.0.8078.100**, V8 **15.6.75.57**) with the patch
series in this directory, on the machine described below. Raw logs are in
[`results/`](results/). The build machine tested nothing in the game; see
[What this machine could not check](#what-this-machine-could-not-check). One match per
variant was later played on a second machine
([Real hardware](#real-hardware-the-same-distzip-on-a-gaming-pc-2026-11-21)).

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
> - **Real hardware:** the dist.zip was then run on a gaming PC with an RTX 5080. Both gates
>   and every check pass there, c31 included
>   ([Real hardware](#real-hardware-the-same-distzip-on-a-gaming-pc-2026-11-21)).
> - **Not compiled:** c32, c50 and c51 (macOS and Linux only).
> - **In the game:** one match per variant on the gaming PC (Electron 43, this build with
>   the switches off, this build with them on), in a harness and not in the client. The build
>   plays, holds a 240 cap exactly and is not slower than Electron 43. One match each cannot
>   rank the switches. c60 trades a wider frame-time spread under a cap for the core it frees.
>   The harness did not ask for raw mouse movement as the client does, so the raw-input
>   patches (c12 to c15) were not in play in those matches.
> - **Profile-guided build (2026-11-24):** the same 22 patches built with a profile recorded
>   in Krunker. Against the build above, in alternating launches, it ran 16 % and 22 % faster
>   on the game's menu (two series) and 28.5 % faster in play (three launches each, raw mouse
>   input on, map and mode of each launch not recorded). Both release gates pass on it on the
>   gaming PC, switches off and on
>   ([comparisons](#real-hardware-the-same-distzip-on-a-gaming-pc-2026-11-21)).

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

### Real hardware: the same dist.zip on a gaming PC (2026-11-21)

The Stage 3 dist.zip, copied to a second machine and run with the same harness. Results in
[`results/real-machine/`](results/real-machine/): `kcc-45.4.1/` for this build and
`control-kcc43/` for the Electron the client ships today. This run was done by the session
that drafted the series, not by the build session. The folder holds the result files and
summaries; the raw `.log` files of these runs are kept on the gaming PC, not in the
repository.

| | |
|---|---|
| Machine | Windows 11 Pro 10.0.26200; Intel Core i9-12900KF (16 cores / 24 threads); 32 GB; NVIDIA GeForce RTX 5080 (driver 32.0.16.1742); three monitors, primary 1920x1080 at 143 Hz; console session |
| Binary | the dist.zip above; zip and `electron.exe` SHA-256 match the values under [Official build](#official-build-outrelease-stage-3) |
| GPU status | `gpu_compositing: enabled`; WebGL2 on ANGLE D3D11 on the RTX 5080. Everything the build VM ran in software runs on the GPU here |
| Control | the client's current Electron 43.0.0 build (Chromium 150.0.7871.46), WebSocket gate only |

**WebSocket gate**: all four runs pass on the first attempt.

| Build | Switches | Run | p99 | max | > 50 ms | Result |
|---|---|---|---|---|---|---|
| 45.4.1 | off | 1 | 33.1 ms | 42.2 ms | 0/497 | pass |
| 45.4.1 | off | 2 | 32.6 ms | 33.9 ms | 0/489 | pass |
| 45.4.1 | on | 1 | 32.3 ms | 33.2 ms | 0/497 | pass |
| 45.4.1 | on | 2 | 32.3 ms | 32.8 ms | 0/496 | pass |
| control 43.0.0 | n/a | 1 | 50.6 ms, re-run 41.9 | 78.1 ms, re-run 48.7 | 6/512, re-run 0/487 | pass on the re-run |
| control 43.0.0 | n/a | 2 | 33.6 ms | 47.9 ms | 0/505 | pass |

**Frame-cap gate**: every launch check (5/5 at 60, 144 and 240) and every runtime check
(14/14 on the 2D page and on the WebGL page) passed on the first attempt, with the switches
off, with every switch on and with c60's switch alone. No run was retried and no WebGL
context was lost. Uncapped, the test pages run at 4,940-5,510 fps.

**A cap above reach** (heavy suite, WebGL page, best of 5 runs interleaved with off):

| Switches | busy 5 ms: cap 1000 / 240 / 144 vs off | busy 3 ms: cap 1000 / 240 / 144 vs off |
|---|---|---|
| all | +0.0 / +0.0 / +0.0 % | +0.2 / +0.0 / +0.0 % |
| c60, first comparison ([`cap-switches/`](results/real-machine/kcc-45.4.1/cap-switches/)) | +0.0 / -0.1 / +0.0 % | **-3.7** / +0.0 / +0.0 % (medians -0.2 / +0.0 / +0.0 %) |
| c60, 10 runs ([`heavy-repeat-precise-busy3/`](results/real-machine/kcc-45.4.1/heavy-repeat-precise-busy3/)) | not repeated | **+3.8** / +0.0 / +0.0 % (medians +0.0 / +0.0 / +0.0 %) |

c60 alone tripped the best-of-5 rule once (-3.7 % against a -3 % limit) and then beat "off"
by the same margin in a 10-run repeat. Both come from one thing: **a launch on this machine
runs in one of two states for its whole life**, about 0.12 ms per frame apart (busy 3 ms: 316
or 329 fps; busy 5 ms: 193 or 198 fps). Which one a launch gets does not follow the switches:

| Variant | Launches in the fast state, busy 3 ms | busy 5 ms |
|---|---|---|
| off | 4 of 23 | 5 of 13 |
| c60 alone | 2 of 18 | 2 of 8 |
| every switch on | 1 of 5 | 2 of 5 |

The cause was not looked for. So the rule's two outcomes are the draw of which variant got a
fast launch, and the direct test is the verdict: within one launch, alternating no cap with a
cap above reach ([`cap-toggle-precise/`](results/real-machine/kcc-45.4.1/cap-toggle-precise/),
3 launches per variant and busy level, 8 cycles each), a capped window differs from its
uncapped neighbours by a median of +0.0 % with the switches off and +0.1 % with c60 at busy
5 ms (worst pair -1.1 % and -0.6 %), and by at most 0.3 % for the 1000 cap at busy 3 ms with
either. (At busy 3 ms this page reaches 329 fps here, so the test's 240 cap binds and its
pairs read -24 to -27 %; that is the cap working, not a loss.) **c60: pass.**

**Synthetic checks** ([`checks/`](results/real-machine/kcc-45.4.1/checks/)): **all pass,
c31 included.** It is the one check the build VM could not run.

| Check | Real hardware |
|---|---|
| c10 | keyup A arrives via sendInputEvent and CDP, switches off and on |
| c11 | re-lock after Esc: off refused (SecurityError, 43 ms after Esc), on locked (45 ms) |
| c12 | option-less re-request on a raw lock: off (400,120) accelerated, on (200,120) raw |
| c13 | motion in wheel packets: off (0,0), on (200,0); wheel deltas equal |
| c14 | what the page sees is the same as with the switch off |
| c15 | coalesced / predicted events per move: off up to 8 / 10, on 1 / 0; sums unchanged |
| e10 | 10/10 checks off and on |
| c20 | RecordMetrics slices: off 135, on 0 |
| c21 | identical GL errors and pixels with fast calls, without, and with every switch; loop 1,214 ms with fast calls, 1,260 ms without |
| v01 | slices carry the limit as set; longest slice 5.38 / 1.61 / 2.53 ms (stock, flag 1, flag 2) |
| c30 | glError 0, context not lost, 15,669 frames |
| **c31** | `GetVSyncIntervalIfAvailable` slices: **off 13,344, on 8** |
| c40 | batch time while suspended flat with the switch; stock grew more than 3x in 4 of 4 scenarios |
| c41 | four renders identical sample for sample |
| c60 | VizCompositorThread at a 144 cap, WebGL page: **96.2 % → 0.6 % of a core**; the cap held in every run |
| input age at a 144 cap (information) | main frame start to DrawAndSwap p50 6.85 ms at busy 0 and 3: one cap period, as on the VM |

**The client starts on this build.** Krunker Civilian Client 1.4.0, run from source on the
dist.zip's `electron.exe` with a throwaway profile, opened its window, loaded the game page
and stayed responsive for 35 s. Its log has one line of note: Electron 45 deprecates
`safeStorage.isEncryptionAvailable`. Nothing was played in the client.

**In a match** ([`in-game/`](results/real-machine/in-game/), 2026-11-22): one match per
variant, played by a person, in the comparison harness and not in the client.
[`test/run-krunker-ab.ps1`](../../test/run-krunker-ab.ps1) loads the game page with the
client's switches, fullscreen at 1920x1080, and records the interval between
`requestAnimationFrame` callbacks while the pointer is locked. The three runs were started one
after another, each from a fresh launch. All three exited normally.

**These matches ran without raw mouse input.** The client adds `unadjustedMovement` to the
game's pointer lock on Windows by default ("Raw Input"); the harness did not. So in all three
runs the lock was the ordinary one, the raw-input patches (c12, c13, c14, c15) did not run,
and "switches on" differed from "off" by the other switches only. Found on 2026-11-23 (below);
the harness has asked for raw movement since then.

| In match | Electron 43.0.0 | 45.4.1, switches off | 45.4.1, switches on |
|---|---|---|---|
| Uncapped: average | 626 fps | 738 fps | 689 fps |
| Uncapped: 2 s windows, 25th to 75th percentile | 493-723 fps | 671-829 fps | 654-742 fps |
| Uncapped: p99 / p99.9 interval | 3.4 / 7.4 ms | 2.8 / 5.1 ms | 2.8 / 4.8 ms |
| Uncapped: frames over 16.7 ms, per minute | 9.9 | 6.9 | 4.2 |
| Uncapped: time measured | 67 s | 104 s | 99 s |
| 240 cap: average | 240.1 fps | 240.1 fps | 240.1 fps |
| 240 cap: p99 / p99.9 / longest interval | 4.4 / 5.8 / 8.0 ms | 4.5 / 7.0 / 10.3 ms | 4.7 / 5.1 / 8.3 ms |
| 240 cap: time measured | 31 s | 50 s | 80 s |

What the three runs show, and what they do not:
- **The build plays a match and the cap is exact.** The longest uncapped frames (113, 154 and
  79 ms) all fall in the first six seconds of play.
- **45.4.1 is not slower than Electron 43 in a match, and has fewer long frames.** The size of
  the lead is not established. The rate inside one match moves more than the difference
  between the runs: the Electron 43 match ran at 340-510 fps in its first half and at
  625-870 fps in its second.
- **Switches on and off cannot be ranked from one run each.** 689 against 738 fps is 0.10 ms
  per frame. That is the size of this machine's two launch states (0.12 ms, above), and the
  switches are fixed at launch, so they cannot be compared inside one launch.
- **c60 widens the frame-time spread under a cap.** With the switches on, the p99 interval at
  the 240 cap is 4.7 ms against 4.4-4.5 ms, and the longest frame of a typical 2 s window is
  5.0 ms against 4.7-4.8 ms. The synthetic c60 check on this machine shows the same at a
  144 cap: interval spread (sd) 0.07 ms with the switch off and 0.23 ms with it on, p99 7.1
  against 7.4 ms. The patch's notes expect this: the stock release is exact only because the
  viz thread spins, and c60 replaces the spin with a timer that fires up to a clock tick
  late. So c60 buys most of a core in the GPU process for about 0.3 ms of timing spread.

The switch's `spin_us` parameter does not change that within its allowed range
([`c60-spin-sweep/`](results/real-machine/kcc-45.4.1/c60-spin-sweep/), synthetic WebGL page,
2 runs of 10 s per cell):

| c60 | 240 cap: interval sd / p99 | 144 cap: interval sd / p99 | VizCompositorThread |
|---|---|---|---|
| off | 0.09 ms / 4.3-4.4 ms | 0.07 ms / 7.1 ms | 95-100 % of a core |
| on, `spin_us` 200 (default) | 0.24 ms / 4.7 ms | 0.23 ms / 7.5 ms | 2-6 % |
| on, `spin_us` 100 | 0.25-0.26 ms / 4.7 ms | 0.26-0.28 ms / 7.5-7.6 ms | 2-5 % |
| on, `spin_us` 0 | 0.25-0.26 ms / 4.7-4.8 ms | 0.23-0.25 ms / 7.4-7.5 ms | 2-6 % |

- The synthetic 240 cap reproduces the in-game figures (p99 4.7 ms on, 4.4 ms off).
- A reading, not a measurement: the wake-up mostly arrives after the release time, so a
  200 µs lead leaves little to spin for. A lead longer than one clock tick plus the hop to
  the viz thread (0.5 ms plus roughly 0.1-0.2 ms) should make the release exact again, for
  under a tenth of a core at a 240 cap. This build clamps `spin_us` to 200, so that needs a
  patch change and a rebuild to test.
- One "off" run at 144 had a single 35 ms frame (sd 0.75 ms with it, p99 unchanged). In two
  "on" runs the harness did not find the viz thread by name and exited 1; the cap held and
  the whole GPU process used 0.0-0.3 % of a core in both.

**A view flick on the ordinary pointer lock (2026-11-23).** In a 7.5-minute session on the
instrumented build (the first profile recording, in [`pgo/krunker-train`](../../pgo/krunker-train/),
switches on) the player saw sudden view flicks that the client on Electron 43 does not show.
The recording's own counts say which mouse path ran:

| Browser process, 7.5 minutes | Count |
|---|---|
| Pointer locks taken (`RenderWidgetHostViewEventHandler::LockPointer`) | 7 |
| Raw input switched on (`HWNDMessageHandler::RegisterUnadjustedMouseEvent`) | 0 |
| Raw mouse packets handled (`HWNDMessageHandler::OnInputEvent`) | 0 |
| Hidden cursor put back in the middle (`MoveCursorToCenter`) | 470 |

- On the ordinary lock Chromium reads movement from the position of the hidden cursor and
  moves it back to the middle of the window when it comes within 15 % of an edge. That
  re-centre does not exist on a raw lock. A re-centre read as movement is a view flick; that
  it is what the player saw is a reading, not something measured.
- The client locks raw by default, on Electron 43 as on any build, so it does not take this
  path. The harness did not. Nothing here points at a patch: the raw-input patches did not
  run at all.
- Both harnesses now add `unadjustedMovement` the way the client does (`preload.js` in each).
  Checked on the instrumented build with a test page: raw input switched on 1, re-centres 0.
- A second session the same day with the fixed harness (5.5 minutes, switches on): 7 pointer
  locks, all raw; 151,802 raw mouse packets handled; **0 re-centres**. c15's lean path ran
  57,579 times. No pointer-lock change request reached the browser in either session, so the
  case c12 guards against did not come up.
- Whether the player still saw a flick in that second session was not recorded. In the six
  launches of 2026-11-24 on the two release builds, all on the raw lock with the switches on,
  **the player saw no flick** (the in-match comparison below). That fits the reading above;
  the ordinary lock was not played again that day, so it is not a side-by-side test.

**Profile-guided build: first comparison, on the game's menu (2026-11-24).** The same 22
patches were built a second time with a profile recorded in Krunker
([`pgo/README.md`](../../pgo/README.md): two sessions on an instrumented build, 13 minutes,
merged with Electron's stock profile at equal weight). The build ran in `out/ReleasePgo` with
the Stage 3 `args.gn` plus `pgo_data_path`: 12 h 30 min, 46,706 steps, 0 failed.

| | Stage 3 build (stock profile) | Profile-guided build |
|---|---|---|
| dist.zip | 158,245,796 bytes | 162,337,280 bytes, SHA-256 `7bcd914af1fb03dd4fb541327c1f86e8bc37fdb7905f35f5737e6d587929fc33` |
| `electron.exe` | 249,946,624 bytes | 255,829,504 bytes, SHA-256 `7b661a3b64741ac2d08b367cfac424e5ac200b7b156266d7b3609ec4eabcb445` |

Both hashes were checked again on the gaming PC. The zip is on the build machine, not in the
repository.

The comparison ([`run-ab-launches.ps1`](../../test/run-ab-launches.ps1), results in
[`pgo-menu/`](results/real-machine/pgo-menu/)): the two builds launched alternately (A B B A),
8 launches each, twice. Every switch on. Each launch sat on the game's menu for one minute and
the first 20 s were left out. The menu draws a live match from a fixed camera, on whatever map
the matchmaker picked. Nobody played, and the desktop was locked.

| Frames per second, per launch | Stage 3 build (stock profile) | Profile-guided build |
|---|---|---|
| Series 1 | 582-691, mean 638 (8 launches) | 706-838, mean 743 (7) |
| Series 2 | 596-718, mean 673 (8) | 730-897, mean 822 (7) |
| Series 2, Sandstorm | 718, 717, 670 | 819, 847, 862, 831 |
| Series 2, Subzero | 596, 714, 630 | 730 |
| Series 2, Burg | 664, 672 | 897, 771 |
| 99th-percentile frame, series 2 | 2.30-3.04 ms | 1.90-2.32 ms |

- **On the menu the profile-guided build is faster in every launch:** +16.5 % (series 1) and
  +22.3 % (series 2) on the means, and +13 % to +25 % map by map in series 2. The maps are
  known for series 2 only, from a picture of each launch's last frame
  ([`maps.txt`](results/real-machine/pgo-menu/series-2/maps.txt)).
- **One launch of the profile-guided build is left out of each series.** In series 2 the
  picture shows why: the page had stopped at the site's "Verify you are human" check and drew
  no 3D scene (1,726 fps). Series 1 has no pictures; its launch at 1,724 fps is left out for
  the same rate. The check was not answered. Thirty-three automated launches in forty minutes
  are a plausible cause (not checked), and no further series was run.
- A single launch of the profile-guided build before the two series ran at 1,038 fps. No
  picture was taken, so what it drew is unknown, and it is not counted.
- **The release gates could not be run behind the lock screen.** An attempt there measured
  nothing: every gate page got 0 frames, so its FAIL lines say nothing about the build and
  are not kept. The gate pages stop drawing on a locked desktop; the comparison harness keeps
  drawing there, probably because it turns window occlusion off as the client does (a
  reading, not checked). The gates ran later that day on the unlocked desktop and pass
  (below).
- **This is not a match.** The menu has no player input and the desktop was locked, so
  nothing was shown on the monitor. The Stage 3 build's rate here is in the range of its
  menu figures from the unlocked desktop on 2026-11-22 (578 and 719 fps). The profile's
  recordings include time on this menu.

**Profile-guided build: in a match (2026-11-24).** The same script with `-Scene match`
(results in [`pgo-match/`](results/real-machine/pgo-match/)): three launches a side in the
order A B B A A B, a person playing each one and ending it with F10. Every switch on, no
frame cap, fullscreen, desktop unlocked. The harness asked for raw mouse movement and every
pointer lock was raw (7 locks, 0 not raw), so this is also the first measured play on the raw
path. Only frames with the pointer locked count.

| Launch | Build | Seconds in match | Frames per second | 1 % low | 0.1 % low | 99th-percentile frame | Frames over 8 ms, per minute |
|---|---|---|---|---|---|---|---|
| 1 | Stage 3 (stock profile) | 122 | 418 | 196 | 112 | 5.1 ms | 31 |
| 2 | Profile-guided | 115 | 533 | 244 | 135 | 4.1 ms | 24 |
| 3 | Profile-guided | 137 | 626 | 270 | 147 | 3.7 ms | 22 |
| 4 | Stage 3 (stock profile) | 154 | 473 | 204 | 121 | 4.9 ms | 28 |
| 5 | Stage 3 (stock profile) | 81 | 467 | 213 | 116 | 4.7 ms | 31 |
| 6 | Profile-guided | 143 | 587 | 250 | 143 | 4.0 ms | 23 |
| Mean | Stage 3 / profile-guided | | 452 / 582 | 204 / 255 | 116 / 142 | 4.9 / 3.9 ms | 30 / 23 |

- **In play the profile-guided build is faster in every launch**, and the two ranges do not
  overlap (418-473 against 533-626). On the script's per-launch figure (the mean of 2-second
  windows: 418, 469, 465 against 534, 621, 584) that is +28.5 %. The 1 % lows are 25 % higher,
  the 0.1 % lows 22 % higher, and frames over 8 ms come 23 a minute instead of 30. The single
  worst frame of a launch shows no pattern (166, 82, 103 ms against 32, 121, 77 ms).
- **Three launches a side is a first figure.** The permutation test cannot go below 10 % with
  three and three (2 of the 20 ways to split six launches), and it sits at that floor. What
  carries the result is the three series together: in the two menu series and in this one,
  every launch of the profile-guided build is above every launch of the other.
- **The map and mode of each launch are not recorded**, nor whether all six were the same: the
  script saves no picture in a match. Inside one launch the rate moves as much as the builds
  differ (10th to 90th percentile of the 2-second windows: 352-499 in launch 1, 447-629 in
  launch 2), so what was on screen matters, and the gain per map is not known.
- The gain is larger in play than on the menu (+16 % and +22 %). Why is not measured.
- **The player saw no view flick in any of the six launches** (asked after the series). Both
  builds, raw lock, switches on.

**Profile-guided build: release gates (2026-11-24).** `run-stage.ps1 -Part gates` on the
gaming PC with the desktop unlocked and nobody at it, 32 minutes
([`kcc-45.4.1-pgo/`](results/real-machine/kcc-45.4.1-pgo/)). The display is set to turn off
after 15 idle minutes, so the run held a display-on request for its length.

| | Stage 3 build, 2026-11-21 | Profile-guided build, 2026-11-24 |
|---|---|---|
| WebSocket gate, switches off | p99 33.1 and 32.6 ms, none over 50 ms: PASS | p99 32.4 and 32.3 ms, 0 of 507 and 514 over 50 ms: PASS |
| WebSocket gate, switches on | p99 32.3 and 32.3 ms, none over 50 ms: PASS | p99 32.2 and 32.2 ms, 0 of 510 and 519 over 50 ms: PASS |
| Frame-cap gate, off and all | PASS | PASS: launch caps 5/5 at 60, 144 and 240; runtime suite 14/14 on the 2D and the WebGL page |
| Cap above reach, all against off | within 0.2 % | within 0.1 % at busy 5 ms; at busy 3 ms best +3.7 %, medians +0.1 % |
| Uncapped rate of the gate's pages (2D off, WebGL off, 2D all, WebGL all) | 4,955 / 5,180 / 5,209 / 5,506 fps | 5,756 / 6,267 / 6,056 / 6,314 fps |

- **Both gates pass with the switches off and on**, every run at the first attempt. GPU
  compositing and WebGL are enabled, WebGL2 on the RTX 5080 through Direct3D 11.
- The +3.7 % is one launch of five in the faster of the machine's two launch states (330 fps
  where the others reach 318), the same pair of states as on the Stage 3 build (329 and 316).
- The gate's own pages run 15 % to 21 % faster uncapped than on the Stage 3 build. That is one
  launch each, three days apart: an indication that agrees with the game figures, not a
  comparison.
- Not run on this build: the c60 gate (`-Part cap-switches`) and the per-patch checks
  (`-Part checks`).

Still not checked anywhere: a match in the client itself, the c60 gate and the per-patch
checks on the profile-guided build, more than one match per switch variant (Electron 43, switches off,
switches on), the raw-input patches off against on in play, more than three launches per
build in play with the same known map in every launch, real mice at 8 kHz, sessions longer
than a few minutes, and the macOS and Linux patches.

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
