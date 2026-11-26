# Electron v45.4.1 KCC series: macOS build and check results

> **These results are for the 22-patch series.** Eleven of those patches were removed on
> 2026-11-26; the reasons are in [README.md](README.md#removed-on-2026-11-26). The eleven
> kept diffs are unchanged, and the lean set has not been built as a set yet. Sections on a
> removed patch are kept as the record behind that decision; the test drivers and pages of
> the removed patches were removed with them, so some files named below no longer exist.

Build of Electron **v45.4.1** (Chromium **156.0.8078.100**, V8 **15.6.75.57**) with the 22
patches in this directory on an Apple M5 MacBook Pro: an arm64 DCHECK build and an official
arm64 Release build, with both release gates and the synthetic checks that apply on macOS run
on each. The Windows results are in [RESULTS.md](RESULTS.md); this file follows its layout.
Raw output stays on the build machine (see [Raw output](#raw-output)). Nothing here was tested
in the game.

> **Status:** done.
> - **Builds:** both compiled all 22 patches with no fix.
> - **Gates and checks:** both release gates and every synthetic check that applies on macOS
>   pass on both builds.
> - **c12 and c15:** checked with injected mouse moves, 3 of 3 runs per variant on both builds
>   ([c12 and c15](#c12-and-c15-with-injected-mouse-input)). Not checked with a physical mouse.
> - **Not settled:** whether macOS also drops raw movement from a real mouse when it merges its
>   reports, as it did with injected moves. That is stock behaviour, which the series neither
>   causes nor fixes. A [physical-mouse check](#manual-check-c12-and-c15-with-a-physical-mouse)
>   can settle it.
> - **Release `dist.zip`:** 120,934,276 bytes, SHA-256
>   `3bbd5ca1e0f379766ffebeb10a263a889e5722d4e491a291761e6ee11d2494e4`.

## Machine (Stage 0)

| | |
|---|---|
| Hardware | MacBook Pro (Mac17,2), Apple M5: 10 CPU cores (4 performance, 6 efficiency), 10-core GPU (Metal 4), **24 GB** unified memory |
| OS | macOS 26.6.2 (25G83), arm64 |
| Display | Built-in Liquid Retina XDR (3024 x 1964 panel) at 1920 x 1200, **120 Hz, variable refresh rate** (NSScreen reports a 24-120 Hz range) |
| Session | The console user's logged-in desktop (Aqua), screen unlocked. Every test launch waits for an awake, unlocked display, and the drivers hold `caffeinate -d -i` |
| Toolchain | Xcode 27.2 (27B52); **macOS 26.5 SDK** (the @electron/build-tools copy; Xcode's own SDK is 27.2); Metal Toolchain 27B47 (`metal` 32023.922); depot_tools from @electron/build-tools; Node.js 22.23.1; Python 3.9.6; Apple Git 2.54.0 |
| Disk | About 690 GiB free at the start |
| Other load | An idle `llama-server` that is not part of this work was left running: footprint 502 MB while idle, 14 GB at its recorded peak. Every test run records its footprint before and after the run and its resident size during it; a run during which it was above 2 GB would not have counted ([Test harness](#test-harness)). It stayed at 502 MB before and after every test run and before and after the Release build; the Release build's link was not sampled ([Stage 3 build](#official-build-outrelease-stage-3)) |

Unlike the Windows build machine, this one has a real GPU and a physical display. WebGL runs
on ANGLE's Metal back end (`ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified
Version)`), GPU compositing and Skia Graphite are on, and frames are presented through
CoreAnimation. The results below are results on this hardware, not environment-limited ones.

## Source tree (Stage 0)

The existing checkout `~/electron` (gclient root; it held the v44.0.0 build) was moved to the
**v45.4.1** tag with `gclient sync --with_branch_heads --with_tags`. Before the sync, the v44
build's `dist.zip` was copied to `~/electron/artifacts-v44/` (SHA-256
`244ff8a161204ba5bbea2d7f74d73fc02385e34a26a18f39d2d7becf1120a8fb`), its `out/Release` was
renamed `out/Release-v44.0.0`, and the tree's local edits (the electron-44 series) were saved as
two patch files next to the zip. Nothing was deleted.

The first sync stopped at `git checkout 156.0.8078.100` in `src`. Chromium 152 had
`third_party/aria-practices/src` as a separate DEPS checkout; Chromium 156 vendors those files
into `src`, and the 47 files of the old checkout were in the way. That directory was moved out
of the tree (not deleted), and the second sync went through in 5 minutes.

| Check | Result |
|---|---|
| `src/electron` | `deaded07eebd` (tag v45.4.1) |
| `src/electron/DEPS` `chromium_version` | `156.0.8078.100` |
| Electron's own patches | 301 Chromium commits on `46876a0c2d` (156.0.8078.100), 37 V8 commits on the pinned `5e51e9c607` |
| SDK | Chromium 156's `mac_sdk_official_version` is 26.5; both builds use the build-tools copy of the 26.5 SDK |
| PGO profile (DEPS hook) | `electron-macos-arm64-1794713269-6bfc23bf15.profdata`; its SHA-256 matches `electron/build/pgo_profiles/macos-arm64.pgo.txt` |

Base commits (also in [`results/macos/base-commits.txt`](results/macos/base-commits.txt)):

| Checkout | Base commit |
|---|---|
| `src` | `625d46a386c1f86e9a1c55aedcd997aafcbc5083` |
| `src/electron` | `deaded07eebdfe9a3737884933b1acbe65971f64` (v45.4.1) |
| `src/v8` | `40b853a3b5aac1f9868dbc01cb2903dbb55562de` |

The `src` and `v8` ids differ from the Windows build's: Electron applies its patches with
`git am`, and the commit ids include the time each commit was made.

`apply.sh --check`: 22 ok, 0 failed. `apply.sh --commit`: 22 commits (19 in `src`, 2 in
`src/electron`, 1 in `src/v8`). `apply.sh --check --base results/macos/base-commits.txt`
confirms that the base plus the 22 diffs gives the committed tree in all three checkouts.

**refresh.sh did not round-trip on macOS until it ignored the system gitattributes file.**
Xcode's git ships a system-wide gitattributes file with `*.m diff=objc`, `*.mm diff=objc` and
`*.swift diff=swift`. Git's objc funcname rule does not match C++ member functions, so a refresh
wrote an empty hunk header into c32's `.mm` hunk, although the code was unchanged. `refresh.sh` now exports
`GIT_ATTR_NOSYSTEM=1` (a commit of its own); after that it reports 0 changed, 22 unchanged.
`apply.sh` needs no change, because `git apply` does not read diff drivers.

## Build configurations

### DCHECK build, `out/Testing` (Stages 1 and 2)

```
import("//electron/build/args/testing.gn")
use_remoteexec = false
use_reclient = false
symbol_level = 0
override_electron_version = "45.4.1"
target_cpu = "arm64"
mac_sdk_path = "//out/Testing/xcode_links/electron/MacOSX26.5.sdk"
```

These are the Windows DCHECK build's arguments plus `target_cpu` and the SDK. Chromium 156 lists
SDK files as outputs of `//build/config/mac:sdk_inputs` and refuses an SDK outside the build
directory, so `out/Testing/xcode_links/electron/MacOSX26.5.sdk` is a symlink to the build-tools
SDK, as @electron/build-tools sets it up. GN: 36,747 targets.

| Pass | What | Steps | Time | Result |
|---|---|---|---|---|
| early, run 1 | the 23 object files the series touches, by name (ninja builds their hard dependencies first); `-j 12` | 24,463 of 35,790 | 13:12-16:17 | **stopped when the machine ran out of memory** (below) |
| early, run 2 | the same, resumed; `-j 8` | 11,328 | 16:25-17:17 | exit 0 |
| full | `autoninja -C out/Testing -j 8 -k 0 electron` | 11,125 | 17:18-17:55 | exit 0; `Electron.app` 545 MB |

**All 22 diffs compiled as drafted, c32 included; this is c32's first compile anywhere. No fix
was needed and there are no fixup commits.** None of the three logs has a compiler warning.
e10's TypeScript change is in the rebuilt `browser_init.js` bundle and in the framework binary.

**Out of memory.** After `apply.sh --commit`, git's automatic gc started four full repacks
(`git repack -d -l --cruft`) of the Chromium checkout at once. Each held 3.5-4.2 GB at 100 % CPU
for more than three hours. With 12 compile jobs on top, that used up the 24 GB: three
JetsamEvent reports (15:52-15:54) name git as the largest process. The session running the
build ended at 16:17, and the repacks finished by themselves at 16:21. ninja kept its finished
steps, and the pass resumed at `-j 8` with git's auto gc off for every git command of the build
environment (`gc.auto=0` and `maintenance.auto=false` through `GIT_CONFIG_COUNT`; nothing written
to a git config). Memory pressure stayed normal from then on.

### Official build, `out/Release` (Stage 3)

```
import("//electron/build/args/release.gn")
use_remoteexec = false
use_reclient = false
override_electron_version = "45.4.1"
target_cpu = "arm64"
symbol_level = 1
blink_symbol_level = 0
mac_sdk_path = "//out/Release/xcode_links/electron/MacOSX26.5.sdk"
```

`release.gn` sets `is_official_build = true`, which turns on ThinLTO. Chromium's
`chrome_pgo_phase = 2` picks Electron's stock profile
`electron-macos-arm64-1794713269-6bfc23bf15.profdata`, and the compile lines carry
`-fprofile-use=` with that profile. `symbol_level = 1` and `blink_symbol_level = 0` keep the
link within 24 GB. The Electron framework's link carries
`-Wl,-mllvm,-unroll-add-parallel-reductions=0`, Electron's guard against the arm64 ThinLTO
miscompile. GN: 36,720 targets.

| Pass | What | Steps | Time | Result |
|---|---|---|---|---|
| build | `autoninja -C out/Release -j 8 -k 0 electron` | 46,393 | 18:57-21:13 (2 h 16 min) | exit 0; `Electron.app` 253 MB |
| zip | `autoninja -C out/Release -j 8 electron:electron_dist_zip` | 6 | 21:13 (15 s) | exit 0 |

**The official build also needed no fix: 0 FAILED, no compiler warning.** The log has only two
warning lines. Both are dsymutil's "no debug symbols in executable", printed while it made the
dSYMs of ANGLE's `libEGL.dylib` and `libGLESv2.dylib`. The framework's ThinLTO link
(`-flto=thin`, `-Wl,--thinlto-jobs=all`) ran from 21:08:18 to 21:13:13, 4 min 56 s.

**Memory.** The build ran at `-j 8` with git's auto gc off, as the DCHECK build had.
- **Pressure:** a watcher checked every 15 s and never saw it critical.
- **Swap:** 1,038.62 MB used at the start and at the end.
- **Out-of-memory reports:** none written.

**The llama-server.** Its footprint was 502 MB at the start (18:57) and 22 s after the link
ended (21:13:35).
- **Missed samples:** the watcher was also meant to record the llama-server's footprint right
  before the framework link and every 15 s during it. It recorded nothing. It looked for an
  `ld64.lld` command line that names the framework, but clang passes the linker its arguments
  in a temporary response file, so the pattern never matched.
- **What that leaves:** if it had woken to its 14 GB peak next to the link, that would most
  likely have shown as swap or memory pressure, and neither did. A shorter or smaller wake
  cannot be ruled out, because nothing sampled the llama-server between 18:57 and 21:13.

**dist.zip** is `out/Release/dist.zip`:
- **Size:** 120,934,276 bytes (115.3 MiB); 584 files, 269,941,162 bytes unpacked.
- **SHA-256:** `3bbd5ca1e0f379766ffebeb10a263a889e5722d4e491a291761e6ee11d2494e4`.
- **A copy unpacked elsewhere:**
  - Its Mach-O binaries are byte-identical to the build tree's, and the framework's symlinks are intact.
  - It starts and reports Electron 45.4.1, Chrome 156.0.8078.100, V8
    15.6.75.57-electron.d384e85dffdbe2dd and Node 24.22.3.
  - GPU compositing and WebGL are enabled, on ANGLE's Metal back end.
- **Signature:** the binaries carry only the linker's ad-hoc signature, as in any unsigned
  Electron build. `codesign --verify --deep --strict` reports that the bundle has no sealed
  resources, in the build tree and in the zip alike. The zip is left exactly as built, as the
  v44 macOS zip was. Signing and notarization are not part of this build.
- **Second copy:** `~/electron/artifacts-v45/electron-v45.4.1-patched-mac-arm64.zip`, next to
  the v44 zip, with the same SHA-256. A later clean of `out/Release` cannot take the only copy.

## Test harness

The Windows drivers are PowerShell. On macOS they run as Node ports next to them in `test/`,
with usage in each file's header. The test programs they launch are the same, unchanged
files:

| Driver | Port of | What it runs |
|---|---|---|
| `posix-kcc-flags.js` | `kcc-flags.ps1` | Shared: the "Everything on" switch list, the crash pattern, one Electron launch into a log |
| `posix-run-ws-gate.js` | `run-ws-gate.ps1` | WebSocket gate (`cdp-test.js`) |
| `posix-run-frame-cap-gate.js` | `run-frame-cap-gate.ps1` | Frame-cap gate (`frame-cap-test.js`) |
| `posix-run-checks.js` | `run-checks.ps1` | Synthetic checks |
| `posix-run-webgl-startup.js` | `run-webgl-startup.ps1` | WebGL startup repeats (`webgl-startup-test.js`) |
| `posix-run-stage.js` | `run-stage.ps1` | A stage's gates, checks and c32 run |
| `mac-run-gpu-backpressure.js`, `mac-gpu-backpressure-test.js`, `mac-gpu-heavy.html` | new | c32: the stock trace, then the uncapped rate with the switch off and on |
| `mac-run-raw-input.js`, `mac-raw-input-test.js`, `mac-mouse-inject.m`, `mac-build-mouse-inject.sh` | new | c12 and c15 with injected mouse moves ([c12 and c15](#c12-and-c15-with-injected-mouse-input)) |

The pass and re-run rules are those of the PowerShell drivers. Added for this machine:

- **Invalid runs.** Every launch waits until the display is awake and the screen unlocked, and
  its log records the display state before and after the run. A run after which the display
  was asleep or locked, or that rendered no frames, is INVALID: it is reported, not counted,
  and run again, up to 3 attempts. A run with no valid attempt leaves its gate INCOMPLETE,
  never passed.
- **Watched processes.** The same applies to a run during which another process sharing the
  unified memory, here the llama-server, was above 2 GB. Its footprint is recorded before and
  after every run, and its resident size is sampled every 2 s during the run.
- **Uncapped figures.** Every capped rate is printed next to the uncapped rate of the same page
  in the same run: setFrameCap(0) after a launch cap, the runtime suite's uncapped baseline,
  and the heavy suite's reach.
- **Features through the main script.** On the DCHECK build, the frame-cap gate passes its
  `--enable-features` list through `frame-cap-test.js` (`--features-via js`). There, field-trial
  parameters on the command line stop stock Electron at startup. The Release build gets every
  switch on the command line.

## Release gates

Both gates run with `--disable-frame-rate-limit --disable-gpu-vsync`, as on Windows. On this
120 Hz panel that means caps of 144 and 240, above the refresh rate, are expected to hold. They
do.

### Stage 2: DCHECK build (22 patches)

Run on 2026-11-24, 18:01-18:48 (c32 first, then the gates, the checks and the WebGL startup
repeats), with `--features-via js`. Every run's display was awake and unlocked before and
after it, and no run was INVALID. The llama-server's footprint was 502 MB before and after
every run, and its largest resident size sampled during a run was 1 MB.

The first gate attempt did not run. The worktree had no `test/node_modules`, so `cdp-test.js`
could not load `ws`. The module was copied from the main checkout (same `package-lock.json`,
ws 8.20.0), the aborted output was kept aside, and the gates were run again. The driver
headers now name `npm ci` in `test/` as a prerequisite.

**WebSocket gate: PASS** with the switches off and on, no re-run:

| Run | p99 | max | over 50 ms | rAF frames (12 s) |
|---|---|---|---|---|
| off 1 | 20.4 ms | 27.7 ms | 0 / 787 | 11,368 |
| off 2 | 20.7 ms | 48.1 ms | 0 / 784 | 11,655 |
| on 1 | 20.0 ms | 24.9 ms | 0 / 789 | 11,973 |
| on 2 | 20.2 ms | 26.0 ms | 0 / 788 | 11,600 |

**Frame-cap gate (variants off and all): PASS.** Each capped rate is shown next to the uncapped
rate of the same page in the same run:

| Suite | off | all |
|---|---|---|
| launch, cap 60 (2d page) | 60.0 fps, 5/5 checks; uncapped 1,743.9 | 60.0 fps, 5/5; uncapped 2,992.7 |
| launch, cap 144 | 144.0 fps, 5/5; uncapped 1,740.9 | 144.0 fps, 5/5; uncapped 2,725.2 |
| launch, cap 240 | 240.0 fps, 5/5; uncapped 1,747.4 | 240.0 fps, 5/5; uncapped 2,705.9 |
| runtime, 2d page | 14/14; uncapped baseline 1,748.9 | 14/14; uncapped baseline 2,677.7 |
| runtime, WebGL2 page | 14/14; uncapped baseline 1,379.5 | 14/14; uncapped baseline 2,885.7 |

Heavy suite (WebGL2 page, 5 runs per variant, interleaved), best / median in fps:

| busy | variant | reach (uncapped) | cap 1000 | cap 240 | cap 144 |
|---|---|---|---|---|---|
| 5 ms | off | 195.7 / 195.7 | 195.9 / 195.8 | 195.9 / 195.8 | 144.0 / 144.0 |
| 5 ms | all | 195.8 / 195.7 | 195.9 / 195.8 | 195.8 / 195.7 | 144.0 / 144.0 |
| 3 ms | off | 322.0 / 321.5 | 322.2 / 321.9 | 240.0 / 240.0 | 144.0 / 144.0 |
| 3 ms | all | 322.1 / 322.1 | 322.1 / 321.8 | 240.0 / 240.0 | 144.0 / 144.0 |

Every cap compares as "ok" (all against off: best between -0.0 % and +0.0 %). Caps above
reach lose nothing.

The uncapped rates of the light pages are 1.5-2.1 times higher with every switch on. The
[c32](#c32-on-this-machine) section shows that c32 is what does that. The caps hold either
way.

### Stage 3: official Release build (22 patches)

Run on 2026-11-24, 21:17-22:07, in this order: c32, the gates, the checks, the light-page
series and the WebGL startup repeats. The switches were passed on the command line
(`--features-via commandline`), as users pass them; field-trial parameters there are fine on
a Release build.
- **Display:** awake and unlocked before and after every run. No run was INVALID.
- **llama-server:** 502 MB footprint before and after every run; the largest resident size
  sampled during a run was 1 MB.

**WebSocket gate: PASS** with the switches off and on. One attempt missed and passed when re-run:

| Run | p99 | max | over 50 ms | rAF frames (12 s) |
|---|---|---|---|---|
| off 1, attempt 1 | 20.2 ms | **269.5 ms** | **1 / 797** | 15,896 |
| off 1, attempt 2 | 21.0 ms | 25.4 ms | 0 / 799 | 16,191 |
| off 2 | 20.4 ms | 22.0 ms | 0 / 801 | 16,314 |
| on 1 | 19.2 ms | 22.3 ms | 0 / 806 | 26,806 |
| on 2 | 19.1 ms | 20.3 ms | 0 / 808 | 27,031 |

**The one miss.** The first attempt of "off 1" had a single gap of 269.5 ms between two
WebSocket messages; the rest of that run was normal (p99 20.2 ms).
- **Re-run:** the gate's re-run rule is the same as in `run-ws-gate.ps1`: a clean run that
  misses only the latency limits runs once more, and a second miss fails. The second attempt passed.
- **What else was running:** the attempt ran 21:19:16-21:19:33. At 21:19:27-28, `dist.zip`
  (121 MB) was being copied and the copy's SHA-256 computed (see
  [Stage 3 build](#official-build-outrelease-stage-3)). The log does not say when the 269.5 ms
  gap occurred, so the two cannot be tied together.

To see whether the gap comes back, the gate ran again from 22:09 to 22:12, with nothing else
running on the machine: 5 runs with the switches off and 5 with them on. All 10 passed without a
re-run:

| Variant | p99 | max | over 50 ms |
|---|---|---|---|
| off | 20.4-21.4 ms | 21.9-24.3 ms | 0 / 4,001 |
| on | 19.3-20.2 ms | 20.0-28.4 ms | 0 / 4,021 |

That makes 8 attempts with the switches off on the Release build, one of which had the 269.5 ms
gap, and 7 with them on, none of which did.

**A Chromium error line in the Release logs.** The line is
`CompositorFrameSinkSupport::MaybeSubmitCompositorFrame, LatencyInfo vector size N is too big`.
- **Where:** in 2 of the 8 attempts with the switches off (1 and 3 times) and in all 7 with them
  on (38-69 times). It is in none of the DCHECK runs and in none of the 29 tracked Windows
  WebSocket logs.
- **What it means:** Chromium logs it when one compositor frame carries more than 100 input
  latency records (`kMaxLatencyInfoNumber`). It then drops that frame's records, which feed
  only latency tracking, and submits the frame as usual, so the frame is still drawn.
- **Stock code:** the check and its message are stock Chromium code (`ui/latency/latency_info.cc`,
  called from `CompositorFrameSinkSupport`). No patch of the series touches either. The line
  appears with the switches off too.
- **Why it shows up here:** its count follows the density of the injected input. The stress sends
  CDP mouse events as fast as the browser takes them:
  - here, 147,000-153,000 in 12 s with the switches off and 261,000-275,000 with them on;
  - on the DCHECK build, 117,000-129,000;
  - on the Windows Release build, 60,000-76,000.
- **Not a failure:** it does not match the crash pattern, and no run crashed.

**Frame-cap gate (variants off and all): PASS.** Each capped rate is shown next to the uncapped
rate of the same page in the same run:

| Suite | off | all |
|---|---|---|
| launch, cap 60 (2d page) | 60.0 fps, 5/5 checks; uncapped 1,325.3 | 60.0 fps, 5/5; uncapped 3,651.4 |
| launch, cap 144 | 144.0 fps, 5/5; uncapped 1,327.8 | 144.0 fps, 5/5; uncapped 3,707.0 |
| launch, cap 240 | 240.0 fps, 5/5; uncapped 1,331.8 | 240.0 fps, 5/5; uncapped 3,707.8 |
| runtime, 2d page | 14/14; uncapped baseline 1,326.9 | 14/14; uncapped baseline 3,705.9 |
| runtime, WebGL2 page | 14/14; uncapped baseline 1,301.6 | 14/14; uncapped baseline 3,504.0 |

Heavy suite (WebGL2 page, 5 runs per variant, interleaved), best / median in fps:

| busy | variant | reach (uncapped) | cap 1000 | cap 240 | cap 144 |
|---|---|---|---|---|---|
| 5 ms | off | 197.9 / 197.8 | 198.0 / 197.9 | 198.1 / 197.9 | 144.0 / 144.0 |
| 5 ms | all | 199.8 / 197.9 | 199.8 / 197.9 | 199.9 / 198.0 | 144.0 / 144.0 |
| 3 ms | off | 333.0 / 332.9 | 333.0 / 333.0 | 240.0 / 240.0 | 144.0 / 144.0 |
| 3 ms | all | 327.9 / 327.7 | 327.8 / 327.8 | 240.0 / 240.0 | 144.0 / 144.0 |

Every cap compares as "ok" under the gate's rule (all's best at least 97 % of off's best).
- **Largest difference:** busy 3 ms, cap 1000: all 327.8 fps against off 333.0, -1.5 % (medians
  -1.6 %).
- **Two rates:** the runs fall into two rates about 48 µs per frame apart: 333 and 327.8 fps at
  busy 3 ms, 199.8 and 197.9 fps at busy 5 ms.
- **Both variants show both:** at busy 3 ms, three of off's five runs reached 333 and none of
  all's did. At busy 5 ms, two of all's runs reached 199.8 and none of off's did. So this looks
  like a state of the machine rather than an effect of a switch, though 5 runs per variant
  cannot settle it. The DCHECK build showed no such split.

The uncapped rates of the light pages are 2.7-2.8 times higher with every switch on (1.5-2.1
times on the DCHECK build). Here too, c32 is what does that ([c32](#c32-on-this-machine)). The
caps hold either way.

## Synthetic checks

### Stage 2: DCHECK build

**SYNTHETIC CHECKS: PASS.**

| Check | Result |
|---|---|
| c10 | PASS with the switches off and on: the page saw keydown and keyup of KeyA, through sendInputEvent and through CDP |
| e10 | PASS off and on, 10/10 checks |
| c11 | PASS: off, a re-lock 37 ms after Esc is rejected (SecurityError); on, the re-lock 36 ms after Esc succeeds |
| c21 | PASS: the fast and the non-fast run give the same error and pixel hashes; TurboFan reached; context not lost |
| v01 | PASS: the flag is listed. Sweep slices: stock 5 ms (77 slices), 1 ms (352), 2 ms (188) |
| c20 | PASS: RecordMetrics slices 63 off, 0 on |
| c30 | PASS: the texture-rebind page ran without crash or DCHECK, glError 0, context alive |
| c31 | N/A: `GetVSyncIntervalIfAvailable` never ran (0 off, 0 on). c31 patches the Windows DComp vsync provider; the build ran with the switch on |
| c40 | PASS: with the switch every scenario stays flat (growth at most 1.5x); stock grew more than 3x in 4 of 4 |
| c41 | PASS: 4 renders (off x2, on x2) are identical, sample for sample |
| lat | INFO: under a 144 cap 144.01 fps; main frame start to DrawAndSwap p50 13.83 ms; submit to display draw p50 6.86 ms (busy 0 and 3 ms alike) |
| raw (c12-c15) | c12, c15: PASS with injected mouse moves, in a later run ([c12 and c15](#c12-and-c15-with-injected-mouse-input)); `raw-input-test.js` itself injects with SendInput, which is Windows-only. c13, c14: N/A, Windows-only |
| c60 | N/A: Windows-only |

**WebGL startup** (`webgl-startup-test.js`, 60 launches per variant, interleaved): with the
switches off, 0 contexts lost, 0 failed, 0 crash lines, rAF/s min 1,295 and median 1,418. With
every switch on, 0 / 0 / 0, rAF/s min 2,679 and median 2,976.

### Stage 3: official Release build

**SYNTHETIC CHECKS: PASS.**

| Check | Result |
|---|---|
| c10 | PASS with the switches off and on: keydown and keyup of KeyA, through sendInputEvent and through CDP |
| e10 | PASS off and on, 10/10 checks |
| c11 | PASS: off, a re-lock 34 ms after Esc is rejected (SecurityError); on, the re-lock 34 ms after Esc succeeds |
| c21 | PASS: the fast and the non-fast run give the same error and pixel hashes, and the same ones as on the DCHECK build (`2ac24dc`, `1bcabb5a`); TurboFan reached; loop 731 ms fast, 750 ms not (DCHECK: 1,616 and 1,589 ms); context not lost |
| v01 | PASS: the flag is listed. Sweep slices: stock 5 ms (134 slices), 1 ms (412), 2 ms (230) |
| c20 | PASS: RecordMetrics slices 75 off, 0 on |
| c30 | PASS: the texture-rebind page ran without crash, glError 0, context alive, 7,423 frames |
| c31 | N/A: `GetVSyncIntervalIfAvailable` never ran (0 off, 0 on), as on the DCHECK build |
| c40 | PASS: with the switch every scenario stays flat (growth at most 1.5x); stock grew more than 3x in 4 of 4 |
| c41 | PASS: 4 renders (off x2, on x2) are identical, sample for sample |
| lat | INFO: under a 144 cap 144.02 fps. Main frame start to DrawAndSwap p50 6.92 ms, one 144 Hz interval; the DCHECK build took 13.83 ms, two. BeginImplFrame to DrawAndSwap p50 13.77 ms at busy 0 ms and 10.82 ms at busy 3 ms. Submit to display draw p50 6.83 ms and 3.88 ms |
| raw (c12-c15) | c12, c15: PASS with injected mouse moves, in a later run ([c12 and c15](#c12-and-c15-with-injected-mouse-input)). c13, c14: N/A, Windows-only |
| c60 | N/A: Windows-only |

**WebGL startup** (`webgl-startup-test.js`, 60 launches per variant, interleaved):
- **Switches off:** 0 contexts lost, 0 failed, 0 crash lines; rAF/s min 1,286, median 1,299.
- **Every switch on:** 0 / 0 / 0; rAF/s min 3,372, median 3,499.
- **Validity:** every one of the 120 launches had an awake, unlocked display before and after
  it. The llama-server stayed at 502 MB throughout.

## c32 on this machine

c32's description says that if a stock trace shows neither wait, the patch has nothing to act
on. On this machine both pages were traced with the switch off and with it on, on both builds.

### DCHECK build (Stage 2)

**GPU-bound page** (`mac-gpu-heavy.html`, 1280 x 688 canvas, 256 shader iterations, 5 s
window):

| | switch off | switch on |
|---|---|---|
| DescheduleUntilFinished | never | never |
| ApplyBackpressure calls (one per frame) | 943 | 952 |
| time in ApplyBackpressure | 4,747 ms of 5,000 (p50 5.0 ms, p90 10.0 ms) | 4,769 ms (p50 5.4 ms, p90 9.8 ms) |
| poll sleeps | 3,807 of 1 ms (about 4 per frame) | 15,086 of 250 µs (about 16 per frame) |
| rate while traced | 188.9 fps | 190.7 fps |

The GPU is the limit here: the GPU main thread spends 95 % of its time waiting for the previous
frame in ApplyBackpressure. The command-buffer deschedule never happens, because
ApplyBackpressure has already waited for the previous frame by then. Untraced, in alternating
launches (6 each): off median 172.9 fps (172.0-187.7), on median 174.0 fps (173.5-183.7), **+0.6 %,
an indication only.** Both variants drift down from about 188 fps at the start of the series
to 172.

**Light page** (`frame-cap.html`, the gates' page, busy 0, WebGL2, 640 x 480 window, 5 s
window). It runs at well over 1,000 fps, so a frame takes less than a millisecond, which is
shorter than one 1 ms sleep step:

| | switch off | switch on |
|---|---|---|
| DescheduleUntilFinished | 114 times, p50 2.51 ms, 273 ms in total | 537 times, p50 0.64 ms, 387 ms in total |
| CommandBufferStub::PerformWork (the deschedule's polls) | 115 | 537 |
| ApplyBackpressure calls (one per frame) | 7,386: p50 1 µs, p90 1.26 ms, 3,517 ms in total | 14,125: p50 1 µs, p90 0.32 ms, 1,944 ms in total |
| poll sleeps in ApplyBackpressure | 2,818 of 1 ms | 6,062 of 250 µs |
| rate while traced | 1,476 fps | 2,823 fps |

Here both waits occur. Most frames do not wait at all (p50 1 µs). A frame that does wait sleeps
at least 1 ms, longer than the frame itself, and a descheduled command buffer resumes no sooner
than 2 ms later (p50 2.51 ms).

To find out which switch makes the light pages faster, four variants were run 6 times each in
rotating order. Round 1 ran off, c32, all-but-c32, all, and each later round started one place
further on:

| Variant | Median | Range | vs off |
|---|---|---|---|
| off (no switch) | 1,423.9 fps | 1,311.9-1,433.0 | |
| c32 only | 2,951.5 fps | 2,803.1-3,003.0 | +107.3 % |
| every switch except c32 | 1,417.4 fps | 1,406.7-1,430.6 | -0.5 % |
| every switch | 2,970.4 fps | 2,820.7-3,006.5 | +108.6 % |

**c32 accounts for the whole gain:** "c32 only" matches "every switch", and "every switch except
c32" matches "off".

The same page in 2D mode gives the same answer. There the command-buffer deschedule never
happens (no WebGL), and only ApplyBackpressure waits: 1,190 sleeps of 1 ms in 5 s with the switch
off, 2,672 of 250 µs with it on.

| Variant (2D) | Median | Range | vs off |
|---|---|---|---|
| off (no switch) | 1,612.0 fps | 1,582.1-1,641.2 | |
| c32 only | 2,886.4 fps | 2,765.5-3,213.4 | +79.1 % |
| every switch except c32 | 1,599.8 fps | 1,583.7-1,638.5 | -0.8 % |
| every switch | 2,912.3 fps | 2,776.9-3,596.5 | +80.7 % |

No launch of the four-variant series crashed, logged a DCHECK or was invalid.

### Release build (Stage 3)

The same series on the official build.

**GPU-bound page:**

| | switch off | switch on |
|---|---|---|
| DescheduleUntilFinished | never | never |
| ApplyBackpressure calls (one per frame) | 987 | 1,006 |
| time in ApplyBackpressure | 4,894 ms of 5,000 (p50 5.0 ms, p90 10.0 ms) | 4,900 ms (p50 5.1 ms, p90 9.5 ms) |
| poll sleeps | 3,917 of 1 ms (about 4 per frame) | 15,494 of 250 µs (about 15 per frame) |
| rate while traced | 197.6 fps | 201.4 fps |

Untraced, in alternating launches (6 each), the result is the same as on the DCHECK build:
- **off:** median 181.9 fps (180.3-196.9).
- **on:** median 183.0 fps (182.0-196.3).
- **Difference:** +0.6 %, an indication only. Both variants drift down from about 197 fps to 181 over the series.

**Light page, WebGL2:**

| | switch off | switch on |
|---|---|---|
| DescheduleUntilFinished | never | 4 times, p50 0.63 ms, 2.5 ms in total |
| ApplyBackpressure calls (one per frame) | 6,411: p50 1.01 ms, p90 1.26 ms, 4,292 ms in total | 15,975: p50 1 µs, p90 0.32 ms, 3,106 ms in total |
| poll sleeps in ApplyBackpressure | 3,438 of 1 ms | 9,775 of 250 µs |
| rate while traced | 1,282 fps | 3,193 fps |

**Here ApplyBackpressure is the only wait that matters.** Unlike on the DCHECK build, the
command buffer is almost never descheduled. More than half the frames wait in ApplyBackpressure
(p50 1.01 ms, against 1 µs on the DCHECK build).
- **Likely reason:** the Release build's CPU side is faster, so it reaches the wait before the
  GPU has finished the previous frame. It then sleeps a whole 1 ms step.
- **Consequence:** with the switch off, this page is slower on the Release build than on the
  DCHECK build, 1,293 fps against 1,424.
- **2D page:** the same, with no deschedule at all. With the switch off, 3,485 sleeps of 1 ms in
  5 s (p90 1.26 ms) and 1,333 fps while traced. With it on, 10,433 sleeps of 250 µs (p90
  0.32 ms) and 3,584 fps.

The four variants, 6 launches each in rotating order, as on the DCHECK build, in fps:

| Variant | WebGL median | range | vs off | 2D median | range | vs off |
|---|---|---|---|---|---|---|
| off (no switch) | 1,293.3 | 1,288.2-1,298.5 | | 1,325.6 | 1,323.7-1,327.0 | |
| c32 only | 3,498.3 | 3,482.7-3,508.3 | +170.5 % | 3,711.3 | 3,702.4-3,715.2 | +180.0 % |
| every switch except c32 | 1,297.0 | 1,286.9-1,300.2 | +0.3 % | 1,328.0 | 1,322.6-1,330.6 | +0.2 % |
| every switch | 3,500.1 | 3,483.7-3,514.9 | +170.6 % | 3,709.6 | 3,703.4-3,718.1 | +179.8 % |

**c32 accounts for the whole gain on the Release build too, and the gain is larger:** 2.7-2.8
times, against 1.8-2.1 times on the DCHECK build. No launch crashed or was invalid.

### Both builds

**Against the event-driven experiment** (`experiment/macos-metal-backpressure`): it was read,
not built or measured here, and not folded in.
- **What it does:** it replaces only ApplyBackpressure's poll, with an event wait that ends
  when the fence signals.
- **For that wait it looks like the better fix:** it has no sleep step at all. c32 trades the
  1 ms step for more, shorter polls: 4 times the sleeps on the GPU-bound page.
- **DCHECK build:** the WebGL light page also waits in the command-buffer deschedule (2 ms first
  poll, then 1 ms). The experiment does not touch that wait; only c32 shortens it.
- **Release build:** that deschedule hardly happens on these pages (never in the stock trace).
  There ApplyBackpressure is the wait that matters, on WebGL and 2D alike, and it is the one the
  experiment replaces. So on the build that ships, the deschedule is no longer an argument
  against the experiment; only measuring it on the Release build could compare the two.
- **Default:** it is enabled by default, which the series does not allow.

What this is and is not:
- **Light page:** it runs at well over 1,000 fps, so its frames are shorter than the 1 ms sleep
  step, and rounding each wait up to 1-2 ms dominates the frame.
- **GPU-bound page:** c32 measured +0.6 % on both builds, an indication only.
- **The game:** neither result says anything yet about it. Its frames are longer, and its rate
  depends on its own GPU and CPU load.

## c12 and c15 with injected mouse input

**PASS on both builds:** every run of every variant came out as expected, 30 runs, none invalid
or repeated. These are injected events, not a physical mouse. They show which movement fields
the lock reads (c12) and what a locked pointermove carries (c15), not how a real device feels.

### How

- **Injector.** macOS lets a process post input events only with the Accessibility permission.
  For this check the user granted it to one small helper app, `KccMouseInject.app`. Its source
  is `test/mac-mouse-inject.m`, and `test/mac-build-mouse-inject.sh` builds it, ad-hoc signed and
  background-only. On the build machine it is in `~/Applications`, and the built app is not
  committed. No other process got the permission, and removing it again is the user's. The
  helper only posts mouse-move events, never a button, key or wheel event, and only while the
  Electron test window is the frontmost app. Otherwise it stops, which happened once, in a stock
  calibration run, when another app came to the front.
- **Two movements per move.** Each injected move carries (+11, +7) as the accelerated delta
  (`kCGMouseEventDeltaX/Y`, which `NSEvent.deltaX/Y` returns) and (+5, +3) as the unaccelerated
  movement (`kCGEventUnacceleratedPointerMovementX/Y`). Chromium reads the second in a pointer
  lock with `unadjustedMovement` and the first otherwise (`web_input_event_builders_mac.mm`).
  So the movement sums show which mode the lock is in, with no acceleration curve involved.
- **Driver.** `test/mac-run-raw-input.js` runs `test/mac-raw-input-test.js` on the Windows
  check's page, `raw-input.html`. The variants are off, c12 (`KccPinRawPointerLock`), c15
  (`KccLeanLockedMouseMove`), c12+c15 and all (README "Everything on"), interleaved, with
  3 runs each per build.

Each phase injects 40 measured moves:

| Phase | Moves | Lock | Expected |
|---|---|---|---|
| adjusted-lock | 20 ms apart | `requestPointerLock()` from unlocked | (440, 280) in every variant |
| raw-move | 20 ms apart | `requestPointerLock({ unadjustedMovement: true })` | (200, 120) in every variant |
| raw-burst | 2 ms apart | the raw lock | c15: coalesced lists of 1 and no predicted events. Stock: predicted events |
| raw-burst-busy | 2 ms apart, main thread busy 25 ms per frame | the raw lock | c15: the same. Stock: coalesced lists of more than 1 |
| after-plain-request | 20 ms apart | `requestPointerLock()` again, without options, while the raw lock is held (c12's case) | Stock (440, 280): downgraded. c12 (200, 120): still raw |

**Validity.** A run counts only when all 40 measured moves of each 20 ms phase reached the
page, so that no move was merged or lost and the sums can be compared. A run that misses this,
or that another app interrupts, is INVALID and is repeated, up to 3 attempts. None was.

### Stock behaviour the test is built around

Both effects showed up in the stock calibration runs (switches off), before any patched
variant ran. The first calibration runs did not match the expected sums, and the test was
changed to allow for them:

- **Not every injected move reaches the page.**
  - A move sent alone by a freshly started helper almost never did.
  - After a new lock, the first locked moves can go missing. When the cursor is outside the
    window, taking the lock warps it into the window, and Chromium then drops the first locked
    move on purpose (`_suppressNextLockedMouseMoveForRecenter` in
    `render_widget_host_view_cocoa.mm`, stock since Chromium commit 25c584c; no patch of the
    series touches it).
  - So every injection starts with 3 lead-in moves of (+1, +1), 150 ms apart. The page records
    every locked mousemove, and the lead-in moves are told apart by their movement. In every
    run, 2 of the 3 arrived after a new lock and 3 of 3 in a held lock.
- **macOS merges injected moves that come faster than the display refresh.**
  - 40 moves 2 ms apart reached the page as 10-12 events, and as 4-5 with the main thread busy.
  - In a merged event, the accelerated delta was the sum of the merged moves, but the
    unaccelerated movement was the value of one move. So in the raw lock the 40 moves summed to
    (50, 30)-(60, 36), not (200, 120). Hence the 20 ms spacing for the sums.
  - This was seen with injected events, whose fields are set by hand. Whether macOS merges a
    real mouse's reports the same way is not known; it may be an artifact of posting events
    like this. **Not settled.** A check with a physical mouse can settle it
    ([manual check](#manual-check-c12-and-c15-with-a-physical-mouse)).

### Results, every run

Sums are of the 40 measured moves; all 40 arrived in every 20 ms phase of every run. For each
burst, the table gives the events at the page per 40 injected, the largest coalesced list and
the most predicted events of one pointermove.

**Release build (`out/Release`):**

| Variant | Run | adjusted-lock | raw-move | raw-burst | raw-burst-busy | after-plain-request |
|---|---|---|---|---|---|---|
| off | 1 | (440, 280) | (200, 120) | 11, 1, 3 | 4, 4, 3 | (440, 280) |
| off | 2 | (440, 280) | (200, 120) | 11, 1, 3 | 4, 3, 3 | (440, 280) |
| off | 3 | (440, 280) | (200, 120) | 11, 1, 3 | 4, 4, 3 | (440, 280) |
| c12 | 1 | (440, 280) | (200, 120) | 11, 1, 3 | 5, 3, 3 | (200, 120) |
| c12 | 2 | (440, 280) | (200, 120) | 10, 2, 3 | 5, 3, 3 | (200, 120) |
| c12 | 3 | (440, 280) | (200, 120) | 11, 1, 3 | 5, 3, 3 | (200, 120) |
| c15 | 1 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (440, 280) |
| c15 | 2 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (440, 280) |
| c15 | 3 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (440, 280) |
| c12+c15 | 1 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (200, 120) |
| c12+c15 | 2 | (440, 280) | (200, 120) | 11, 1, 0 | 5, 1, 0 | (200, 120) |
| c12+c15 | 3 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (200, 120) |
| all | 1 | (440, 280) | (200, 120) | 11, 1, 0 | 5, 1, 0 | (200, 120) |
| all | 2 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (200, 120) |
| all | 3 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (200, 120) |

**DCHECK build (`out/Testing`):** no crash, no DCHECK, and no crash line in any log.

| Variant | Run | adjusted-lock | raw-move | raw-burst | raw-burst-busy | after-plain-request |
|---|---|---|---|---|---|---|
| off | 1 | (440, 280) | (200, 120) | 11, 1, 3 | 5, 3, 3 | (440, 280) |
| off | 2 | (440, 280) | (200, 120) | 12, 1, 3 | 5, 3, 3 | (440, 280) |
| off | 3 | (440, 280) | (200, 120) | 11, 1, 3 | 5, 3, 3 | (440, 280) |
| c12 | 1 | (440, 280) | (200, 120) | 11, 1, 3 | 5, 3, 3 | (200, 120) |
| c12 | 2 | (440, 280) | (200, 120) | 11, 1, 3 | 4, 4, 3 | (200, 120) |
| c12 | 3 | (440, 280) | (200, 120) | 11, 1, 3 | 5, 3, 3 | (200, 120) |
| c15 | 1 | (440, 280) | (200, 120) | 11, 1, 0 | 5, 1, 0 | (440, 280) |
| c15 | 2 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (440, 280) |
| c15 | 3 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (440, 280) |
| c12+c15 | 1 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (200, 120) |
| c12+c15 | 2 | (440, 280) | (200, 120) | 11, 1, 0 | 5, 1, 0 | (200, 120) |
| c12+c15 | 3 | (440, 280) | (200, 120) | 12, 1, 0 | 4, 1, 0 | (200, 120) |
| all | 1 | (440, 280) | (200, 120) | 11, 1, 0 | 5, 1, 0 | (200, 120) |
| all | 2 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (200, 120) |
| all | 3 | (440, 280) | (200, 120) | 11, 1, 0 | 4, 1, 0 | (200, 120) |

**What the switches change**, the same on both builds:

- **c12:** after the plain re-request, the lock stays raw, (200, 120), in 9 of 9 runs with the
  switch (c12, c12+c15, all). Without it (off, c15), the lock is downgraded to the adjusted
  path, (440, 280), in 6 of 6: the stock behaviour the patch is for.
- **c15:** raw moves carry no predicted events and one coalesced entry in 9 of 9 runs with the
  switch, idle and busy. Without it, a pointermove carries up to 3 predicted events. Coalesced
  lists stay mostly at 1 while the page is idle, because macOS has already merged the moves,
  and reach 3-4 entries with the main thread busy. The movement sums are the same with and
  without the switch.
- **Neither** changes the adjusted lock, or the raw lock before the re-request.

## Per patch

What each of the 22 patches got on this machine. Every patch compiled into both builds.
"Every switch on" (README "Everything on") was part of every gate and check run, so each
patch's code ran with its switch on wherever its code path is reached on macOS. Each result
holds for both builds.

| # | Patch | OS | Checked here by | Result |
|---|---|---|---|---|
| c01 | `ws-priority` | all | WebSocket gate (always on) | PASS (Release: 1 of 8 attempts with the switches off had one 269.5 ms gap; it passed on its re-run, and 10 more runs had no gap: [Stage 3](#stage-3-official-release-build-22-patches)) |
| c02 | `frame-pacing` | all | every gate run (its always-on part); `CustomMaxPendingFrames:count/2` kept out of every gate, as on Windows | no separate check |
| c03 | `frame-cap` | all | frame-cap gate, launch suites (`CustomFrameCap:fps/N`) | PASS |
| e01 | `frame-cap-set-frame-cap` | all | frame-cap gate, runtime and heavy suites (`setFrameCap`) | PASS |
| c10 | `keyup-after-handled-keydown` | all | c10 | PASS |
| c11 | `pointer-lock-esc-cooldown` | all | c11 | PASS |
| c12 | `pin-raw-pointer-lock` | Win, mac | injected mouse moves ([c12 and c15](#c12-and-c15-with-injected-mouse-input)) | PASS: after a plain re-request the lock stays raw (9 of 9 runs with the switch; downgraded in 6 of 6 without). Not checked with a physical mouse |
| c13 | `raw-input-keep-wheel-motion` | Win | - | N/A |
| c14 | `raw-input-fast-path` | Win | - | N/A |
| c15 | `lean-locked-mouse-move` | Win, mac | injected mouse moves ([c12 and c15](#c12-and-c15-with-injected-mouse-input)) | PASS: raw moves carry no predicted events and one coalesced entry (9 of 9 runs with the switch; without it up to 3 predicted, and lists of up to 4 when busy). Not checked with a physical mouse |
| e10 | `skip-unobserved-input-emits` | all | e10 | PASS |
| c20 | `skip-canvas-perf-sampling` | all | c20 | PASS |
| c21 | `webgl-fast-api-calls` | all | c21 | PASS |
| v01 | `cppgc-sweep-slice` | all | v01 | PASS |
| c30 | `label-textures-once` | all | c30 (no crash or DCHECK; nothing to count on Metal) | PASS |
| c31 | `cache-vsync-interval` | Win | c20/c30/c31 run: its code path never ran | N/A |
| c32 | `mac-gpu-backpressure-poll` | mac | trace and launch series on both builds ([c32](#c32-on-this-machine)) | its waits occur (on the Release build almost only ApplyBackpressure's); GPU-bound page +0.6 % on both builds (indication); light page 1.8-2.1x (DCHECK) and 2.7-2.8x (Release) |
| c40 | `audioparam-coalesce` | all | c40 | PASS |
| c41 | `hrtf-panner-krate-angles` | all | c41 | PASS |
| c50 | `x11-allow-unredirect` | Linux/X11 | - | N/A |
| c51 | `x11-raw-mouse` | Linux/X11 | - | N/A |
| c60 | `frame-cap-precise-release` | Win | - | N/A |

## What this machine could not check

- **c12 and c15 with a physical mouse.** Both were checked with injected moves
  ([c12 and c15](#c12-and-c15-with-injected-mouse-input)). These show which fields the lock
  reads and what a locked pointermove carries. Not checked: a real device, and whether macOS
  also drops raw movement from a real mouse's reports when it merges them, as it did with
  injected moves ([manual check](#manual-check-c12-and-c15-with-a-physical-mouse)).
- **c13, c14, c31, c60:** Windows-only code paths. **c50, c51:** Linux/X11 only.
- **CustomMaxPendingFrames:count/2** was kept out of every gate (documented conflict with the
  frame cap) and not measured.
- **The game.** Nothing here was run against the game, by design. The c32 numbers are about two
  test pages and say nothing yet about the game.
- **Profile.** The Release build uses Electron's stock macOS arm64 profile. No
  Krunker-trained profile was made.

### Manual check: c12 and c15 with a physical mouse

At the Mac, with the Release build (or `out/Testing`), from `test/`:

```
<Electron.app>/Contents/MacOS/Electron mac-raw-mouse-manual.js
<Electron.app>/Contents/MacOS/Electron mac-raw-mouse-manual.js --enable-features=KccPinRawPointerLock,KccLeanLockedMouseMove
```

In each launch:

1. Click the window. The page takes a pointer lock with `unadjustedMovement: true`.
2. Press Space, move the mouse slowly over a fixed distance (one edge of the mouse pad to the
   other), and press Space again. Then do the same distance fast.
3. Press R. The page asks for the lock again without the option, as a game does when it
   re-locks. Do a slow and a fast sweep again.
4. Read off:
   - **c12:** "fast / slow" for the two phases. Raw input gives about 1; OS acceleration gives
     clearly more than 1. Stock: about 1 before R, above 1 after R. With
     `KccPinRawPointerLock`: about 1 both times.
   - **c15:** the pointermove table, read while the raw lock is held (before R), after moving
     fast. Stock: predicted events on most moves, coalesced lists of more than one entry with a
     fast mouse. With `KccLeanLockedMouseMove`: 0 predicted events and 1 coalesced entry on
     every move.

To settle the merge question from the injected check, one launch with the switches off is
enough. In the raw lock (before R), sweep a measured distance, for example 10 cm along a ruler,
once slowly and once fast, and read:

- **The largest coalesced list per move** (the c15 table) during the fast sweep. Above 1:
  macOS handed Chromium several reports per frame, so nothing was merged before Chromium, and
  the injected result is an artifact of injection. 1: macOS merged the reports.
- **The two sums against the mouse's resolution**, if it is known: a sweep of d cm should give
  about DPI × d / 2.54 counts. Sums far below that mean raw movement is lost.
- **"fast / slow".** Clearly below 1 also means raw movement is lost. About 1 does not settle it
  on its own: a 1000 Hz mouse reports every millisecond in any steady sweep, slow or fast, so
  both sweeps could lose a similar share.

## Raw output

Logs, traces and per-run JSON are under `results/macos/` on the build machine and are not
committed (`*.log` is ignored): `stage2-testing/` for the DCHECK build, `stage3-release/` for
the Release build, and the build logs next to them. The injected c12/c15 check is in
`raw-input-release/` and `raw-input-testing/`: `series/` holds the counted runs, and the stock
calibration and diagnosis runs are next to it. Only `results/macos/base-commits.txt` is
committed.
