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
| `frame-cap-test.js` + `frame-cap.html`, `run-frame-cap-gate.ps1` | Frame-cap gate: launch, runtime and heavy suites. Also the cpu (c60) and latency (c61, then input age) suites |
| `perfetto-trace.js` | Reads the Perfetto protobuf traces Electron 45 writes (see 6 below) |
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

_pending_

## Per patch

"Compiled" is the Windows build of this machine: the DCHECK build in Stage 1, the official
build in Stage 3. **No patch needed a change to compile** (no fixup commits). The checks are
in [`test/`](../../test/) and run each binary with the patch's switch off and on. Stock
behaviour comes from the v45.0.0-alpha.14 control
([`results/control-alpha14/`](results/control-alpha14/)), which has only the ported patches.
Stage 2 outcomes are on the DCHECK build; the Release outcomes are in the last column.

| Patch | Compiled | Changed | Check (Stage 2, DCHECK) | Release | Not tested here |
|---|---|---|---|---|---|
| c01 `ws-priority` | yes | nothing | WS gate: p99 32-39 ms everywhere; strict pass on re-runs (see [Release gates](#release-gates)) | _pending_ | in-game network behaviour |
| c02 `frame-pacing` | yes | nothing | frame-cap gate (uncapped and capped rates) | _pending_ | `CustomMaxPendingFrames:count/N` values |
| c03 `frame-cap` | yes | nothing | frame-cap gate: launch and runtime caps 60/144/240, hide/show, resize, change of N, uncap, second view, all within 1%: **pass** | _pending_ | GPU swap chains, real vsync |
| e01 `frame-cap-set-frame-cap` | yes | nothing | `win.setFrameCap` drives the runtime suites: **pass** | _pending_ | |
| c10 `keyup-after-handled-keydown` | yes | nothing | keyup A reaches the page after a prevented key, via sendInputEvent and CDP: **pass** (stock: lost) | _pending_ | real keyboards, IME |
| c11 `pointer-lock-esc-cooldown` | yes | nothing | re-lock ~44 ms after a scripted Esc: off refused (cooldown), on locked; controls pass: **pass** | _pending_ | a physical Esc key |
| c12 `pin-raw-pointer-lock` | yes (Windows half) | nothing | option-less re-request on a raw lock: off (352,112) accelerated, on (200,120) raw: **pass** | _pending_ | whether the client triggers it; macOS |
| c13 `raw-input-keep-wheel-motion` | yes | nothing | motion in wheel packets: off (0,0), on (200,0); wheel deltas equal: **pass** | _pending_ | real mice |
| c14 `raw-input-fast-path` | yes | nothing | same page-visible results as off: **pass** | _pending_ | the cost it saves |
| c15 `lean-locked-mouse-move` | yes (Windows half) | nothing | raw moves: coalesced 1 / predicted 0 (off: 16 / 10), sums unchanged: **pass** | _pending_ | the cost it saves; macOS |
| e10 `skip-unobserved-input-emits` | yes (JS bundle rebuilt) | nothing | 10/10 emit checks off and on, preventDefault still works: **pass** | _pending_ | the cost it saves |
| c20 `skip-canvas-perf-sampling` | yes | nothing | RecordMetrics slices off 7, on 0: **pass** | _pending_ | the spike it removes |
| c21 `webgl-fast-api-calls` | yes (bindings rebuilt) | nothing | identical GL errors and pixels with fast calls, without, and with every switch: **pass** | _pending_ | speed on a GPU |
| v01 `cppgc-sweep-slice` | yes | nothing | flag listed; slices carry max_duration_ms 5 / 1 / 2 as set, p50 5.10 / 1.15 / 2.15 ms: **pass** | _pending_ | effect on frame times |
| c30 `label-textures-once` | yes | nothing | texture page runs with the switch, glError 0, no DCHECK: **pass** | _pending_ | the D3D11 cost (no GPU) |
| c31 `cache-vsync-interval` | yes | nothing | **not exercised**: no DCompPresenter without a GPU (0 calls off and on); runs with the switch on | _pending_ | everything it does |
| c32 `mac-gpu-backpressure-poll` | **no** (macOS only) | nothing | desk-checked against the tree: nothing would fail | n/a | everything |
| c40 `audioparam-coalesce` | yes | nothing | batch time while suspended flat with the switch (0.50-1.02x), off 12-13x: **pass** | _pending_ | whether Krunker hits it |
| c41 `hrtf-panner-krate-angles` | yes | nothing | 4 renders off/on identical sample for sample: **pass** | _pending_ | the cost it saves |
| c50 `x11-allow-unredirect` | **no** (Linux only) | nothing | desk-checked: nothing would fail | n/a | everything |
| c51 `x11-raw-mouse` | **no** (Linux only) | description only (a desk-check found a minor logic bug, recorded) | desk-checked: nothing would fail | n/a | everything |
| c60 `frame-cap-precise-release` | yes | nothing | frame-cap gate with it on: **pass**; VizCompositorThread at a 144 cap 88% → 16% of a core: **pass** | _pending_ | GPU swap chains, real vsync |
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
- **The Krunker-trained PGO profile** was not used: the Release build uses Electron's own
  profiles from `release.gn`.
