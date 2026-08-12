[![GitHub Downloads](https://img.shields.io/github/downloads/bigjakk/Electron-Websocket-Fix/total)](https://github.com/bigjakk/Electron-Websocket-Fix/releases)
# Electron WebSocket Fix

Patched Electron builds that fix a Chromium regression where continuous mouse input starves WebSocket and Worker message dispatch when `--disable-frame-rate-limit` is active.

This is critical for competitive browser-based games (like [Krunker](https://krunker.io)) running in Electron, where shooting (holding left click + moving mouse) causes network freezes of 100-300ms+.

## Downloads

Pre-built patched binaries for **Windows x64** and **Linux x64** are available on the [Releases page](https://github.com/bigjakk/Electron-Websocket-Fix/releases). Each release targets a specific Electron version — download the asset matching your platform from the release you need.

All builds are full release builds (`is_official_build = true`) with maximum optimizations. Additional versions can be built from source -- see [`BUILD-GUIDE.md`](BUILD-GUIDE.md).

## The Problem

When an Electron app uses these flags (common for competitive gaming):

```javascript
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
```

...continuous mouse input with left-click held down causes WebSocket `onmessage` callbacks to be delayed by 100-300ms+. This manifests as network "freezing" -- player positions stop updating, hit registration breaks, and the game becomes unplayable during gunfights.

### Root Cause

Three factors in Chromium's Blink main thread scheduler combine to create the issue:

1. **Input tasks at `kHighestPriority`** (priority level 1) while WebSocket/Worker tasks sit at `kNormalPriority` (level 7)

2. **No cross-priority anti-starvation** in `task_queue_selector.cc` -- it always picks from the highest active priority queue, with no mechanism to let lower-priority tasks run

3. **Compositor priority boost during input** -- when mouse is held + moving (`UseCase::kMainThreadCustomInputHandling`), the compositor queue gets boosted to `kHighestPriority`. With `--disable-frame-rate-limit`, the `BackToBackBeginFrameSource` posts `SEND_BEGIN_MAIN_FRAME` tasks at zero delay, creating an infinite loop of highest-priority tasks that permanently starves everything else

This regression was introduced in Chromium 84 when `PrioritizeCompositingAfterInput` was made unconditional ([CL 2132022](https://chromium-review.googlesource.com/c/chromium/src/+/2132022)).

## The Fix

The latest builds apply **three complementary patches**, plus a macOS-only crash guard:

### 1. Input priority (this project)

Two changes in `main_thread_scheduler_impl.cc`:

1. **Lower input task priority** from `kHighestPriority` to `kNormalPriority`
2. **Cap compositor priority** to `kNormalPriority` via `std::max()`

This stops continuous mouse input from starving WebSocket/Worker message dispatch. See [`patches/ws-priority-patch.diff`](patches/ws-priority-patch.diff) for the exact diff.

### 2. Frame pacing (originally [thegu5](https://github.com/thegu5), extended by [bigjakk](https://github.com/bigjakk))

The base is a one-line change to `IsDrawThrottled()` from [thegu5](https://github.com/thegu5) (Electron commit [`733d1c2`](https://github.com/electron/electron/commit/733d1c2cdab84ebc252d4f672b3527a1fc73bd01)): drop the `!settings_.disable_frame_rate_limit` exemption so frames stay throttled even under `--disable-frame-rate-limit`. This project extends that fix to expose the pending-submit-frame queue depth as a runtime feature param, tunable without a rebuild:

```cpp
// Default 1 (stock behavior); raise at runtime with
// --enable-features=CustomMaxPendingFrames:count/2
BASE_FEATURE(kCustomMaxPendingFrames, "CustomMaxPendingFrames",
             base::FEATURE_ENABLED_BY_DEFAULT);
constexpr base::FeatureParam<int> kMaxPendingFramesCount{
    &kCustomMaxPendingFrames, "count", kMaxPendingSubmitFrames};

bool SchedulerStateMachine::IsDrawThrottled() const {
  if (base::FeatureList::IsEnabled(features::kNoCompositorFrameAcks))
    return false;
  return pending_submit_frames_ >= MaxPendingSubmitFrames();  // floored at 1
}
```

This keeps `BackToBackBeginFrameSource` from flooding the main thread with zero-delay `SEND_BEGIN_MAIN_FRAME` tasks (root-cause factor 3 above), while letting the queue depth be raised at runtime:

| Flag | Pending frames | Effect |
|------|----------------|--------|
| _(none)_ | 1 | stock behavior, safe default |
| `--enable-features=CustomMaxPendingFrames:count/2` | 2 | ~+27% frame throughput, still 0% WS stalls |

> **Do not combine `count/2` (or higher) with the frame cap in section 3.** The two features are in direct tension and produce inverted behavior together — see the limitation note below.

See [`patches/frame-pacing-patch.diff`](patches/frame-pacing-patch.diff) for the full change.

### 3. Exact FPS cap -- CustomFrameCap

Frame pacing (section 2) throttles runaway frame generation but doesn't let you pick a *number*. This patch does: it caps FPS at an exact target while `--disable-frame-rate-limit` is active, and lets you change that target at runtime without a restart.

Under `--disable-frame-rate-limit` the per-window BeginFrame source is `BackToBackBeginFrameSource`, whose cadence is gated only by swap-buffer acks through `DisplayScheduler`'s `SetIsGpuBusy` latch. The patch turns `DidReceiveSwapBuffersAck()` into a pacing gate that stretches those ack releases onto a fixed **absolute-time grid**, which yields an exact cap with dense submission and avoids the vsync-grid snapping that broke earlier metadata-based attempts. The grid advances by whole intervals and is never re-anchored to `Now()`, so a cycle that overshoots can compensate rather than making the cap a per-frame floor.

**Set the cap at launch:**

```bash
# Cap at 240 FPS. Clamped to 30..1000; 0 or absent = stock behavior.
electron.exe myapp --disable-frame-rate-limit --enable-features=CustomFrameCap:fps/240
```

**Or change it at runtime** (new `BaseWindow` method, no restart needed):

```javascript
win.setFrameCap(240);  // cap at 240 FPS
win.setFrameCap(120);  // re-cap, takes effect immediately
win.setFrameCap(0);    // 0 or negative -> uncapped
```

Runtime adjustment goes through a dedicated `DisplayPrivate.SetFrameCapInterval(TimeDelta)` mojo method rather than reusing the vsync-parameter channel, so real display vsync updates can never be misread as cap commands. `Compositor` caches the value and re-sends it on frame-sink re-bind, so a window that is hidden and shown again keeps its cap.

Measured on Electron v43.0.0 / Chromium 150.0.7871.46, win32-x64 (uncapped control: 282.8 FPS):

| Setting | Measured | Error |
|---------|----------|-------|
| `CustomFrameCap:fps/240` at launch | 238.1 | -0.79% |
| `fps/0` or param absent | indistinguishable from control | — |
| `setFrameCap(120)` at runtime | 123.4 | +2.8% |
| `setFrameCap(150)` at runtime | 150.03 | +0.02% |
| `setFrameCap(150)`, after hide/show | 150.03 | +0.02% |
| `setFrameCap(0)` at runtime | 264.3 (uncapped) | — |

> **Known limitation — do not co-emit with `CustomMaxPendingFrames:count/N` where N >= 2.** The two features don't merely cancel out, they *invert*: measured rAF rates **rise** as the cap tightens. On a machine whose depth-2 uncapped ceiling is 551 FPS, a cap of 285 gave 555, 240 gave 666, 120 gave 804, 60 gave 1008, and 30 gave 1381.
>
> This is by design, not a bug in the implementation: `CustomMaxPendingFrames` exists to let the renderer run *ahead* of the draw loop, and this cap works by *pacing* that same draw loop. The decoupling happens in cc's scheduler in the renderer process, upstream of anything `DisplayScheduler` can influence, so no change confined to viz can fix it. Use one feature or the other — at the default `count/1`, the cap behaves correctly.

The change spans two git repos, so it ships as two patch files: [`patches/frame-cap-patch.diff`](patches/frame-cap-patch.diff) (apply from the Chromium `src` root) and [`patches/frame-cap-electron-patch.diff`](patches/frame-cap-electron-patch.diff) (apply from `src/electron`).

### 4. macOS GPU crash guard (macOS builds only)

On macOS, `--disable-frame-rate-limit` switches the display to a *synthetic* begin-frame source, so `external_begin_frame_source()` returns null. A June 2026 Chromium regression (commit `0348f5809af17d`) then calls a virtual method on that null pointer in `RootCompositorFrameSinkImpl::DisplayDidReceiveCALayerParams()`, crashing the GPU process (`exit_code=11`, black screen). This affects the entire Electron 43.x / Chromium 150 (`7871`) line — the upstream fix (`f0d1fd614eefb`) was not backported — so every macOS build needs a one-line null guard:

```cpp
// Guard the call the same way the adjacent display_client_ call is guarded.
if (auto* ebfs = external_begin_frame_source())
  ebfs->DidReceiveNewCALayerParams();
```

Windows and Linux are unaffected and don't need this patch. See [`patches/macos-gpu-crash-patch.diff`](patches/macos-gpu-crash-patch.diff).

### Test Results

12-second automated stress test with continuous CDP mouse input (left-click held, circular movement):

| Build | p99 Latency | Max Latency | Messages >50ms | Mouse Events | Frames |
|-------|-------------|-------------|----------------|-------------|--------|
| **Unpatched** | ~97ms | ~308ms | 8.6% | ~11,380 | ~6,300 |
| **Patched** | ~34ms | ~38ms | **0%** | ~12,360 | ~7,620 |

The patch not only eliminates starvation but actually **improves** both input throughput (+9% mouse events) and frame rate (+21% frames) because it prevents the input/compositor priority cascade from monopolizing the main thread.

_The numbers above reflect the input-priority patch (the WebSocket-starvation fix). The frame-pacing patch is a complementary change that throttles runaway frame generation under `--disable-frame-rate-limit` and exposes a runtime-tunable queue depth (see above)._

## Usage

### Option A: Direct Binary

Extract the zip and run your app:

**Windows:**

```bash
electron.exe path/to/your/app
```

**Linux:**

```bash
./electron path/to/your/app
```

**Higher Max FPS (optional):** add `--enable-features=CustomMaxPendingFrames:count/2` to allow 2 pending compositor frames (~+27% frame throughput in testing). Omit it for the safe default of 1.

### Option B: Replace in node_modules

```bash
# Back up original
mv node_modules/electron/dist node_modules/electron/dist-original

# Extract patched version
mkdir node_modules/electron/dist
cd node_modules/electron/dist
unzip path/to/electron-v40.6.1-release-patched-win32-x64.zip
```

### Option C: electron-builder

In `package.json`:

```json
{
  "build": {
    "electronDist": "path/to/extracted/dist",
    "electronVersion": "40.6.1"
  }
}
```

### Option D: electron-forge

In `forge.config.js`:

```js
module.exports = {
  packagerConfig: {
    electronZipDir: 'path/to/extracted/dist'
  }
};
```

## Verification

An automated stress test is included in the [`test/`](test/) directory:

```bash
cd test
npm install

# Windows
path/to/patched/electron.exe cdp-test.js 8085 PATCHED

# Linux
path/to/patched/electron cdp-test.js 8085 PATCHED
```

The test uses CDP `Input.dispatchMouseEvent` to simulate continuous mouse input (the only reliable automated method -- Electron's `sendInputEvent` API bypasses the compositor thread and doesn't trigger the bug).

Expected output for a patched build: **0% of WebSocket messages >50ms**.

## Building From Source

Full build instructions are in [`BUILD-GUIDE.md`](BUILD-GUIDE.md).

Quick summary:

```bash
# 1. Set up environment (depot_tools, build toolchain, Python, etc.)
# 2. Initialize and sync Electron source
e init --root=$HOME/electron my-build --import release  # Linux
e init --root=C:\electron my-build --import release      # Windows
e sync

# 3. Check out desired version
cd src/electron && git checkout v40.6.1
cd .. && gclient sync --with_branch_heads --with_tags

# 4. Apply patches -- from the Chromium src root
git apply path/to/ws-priority-patch.diff     # input priority (this repo)
git apply path/to/frame-pacing-patch.diff    # frame pacing (thegu5)
git apply path/to/frame-cap-patch.diff       # exact FPS cap (Chromium half)
git apply path/to/macos-gpu-crash-patch.diff # macOS only: GPU crash guard

# ...and the Electron half of the frame cap, from src/electron
cd electron && git apply path/to/frame-cap-electron-patch.diff && cd ..

# 5. Configure and build
mkdir -p out/Release
# Set out/Release/args.gn:
#   import("//electron/build/args/release.gn")
#   is_official_build = true
#   use_remoteexec = false
#   use_reclient = false
buildtools/linux64/gn gen out/Release    # Linux
buildtools/win/gn.exe gen out/Release    # Windows
ninja -C out/Release electron
ninja -C out/Release electron:electron_dist_zip
```

Expect 6-10+ hours for a full build on a modern machine (24 cores, 64GB RAM).

## Patch Details

Most of these patches modify Chromium source (not Electron source), so they apply to any Electron version since Electron 10 (Chromium 84+) — the exception is the frame cap, whose runtime-adjustment half touches Electron's shell. The input-priority, frame-pacing, and frame-cap patches are cross-platform (Windows, Linux, macOS); the GPU-crash guard is macOS-only. Line numbers may shift between versions but the function names remain the same.

**Input priority** -- `third_party/blink/renderer/platform/scheduler/main_thread/main_thread_scheduler_impl.cc`:

- `ComputePriority()` -- search for `PrioritisationType::kInput`
- `ComputeCompositorPriority()` -- search for that function name

**Frame pacing** -- `cc/scheduler/scheduler_state_machine.cc`:

- `IsDrawThrottled()` -- drop the `!settings_.disable_frame_rate_limit` term and route the throttle through a `CustomMaxPendingFrames` feature param (default 1; `--enable-features=CustomMaxPendingFrames:count/2` for 2)

**Exact FPS cap** -- spans two repos, so it ships as two diffs:

- `components/viz/service/display/display_scheduler.cc` -- `DidReceiveSwapBuffersAck()` becomes a pacing gate; the stock body moves verbatim into `DidReceiveSwapBuffersAckImpl()`. Every gate-deferred ack owes exactly one `Impl()` call, tracked by `pending_release_count_`, with a single `base::DeadlineTimer` scheduling the next payout
- `components/viz/service/display/display.cc` -- `Resize()` and `DisableSwapUntilResize()` flush the pending delay, the latter *before* `ForceImmediateSwapIfPossible()`, or a held ack makes the forced pre-resize swap a silent no-op
- `shell/browser/api/electron_api_base_window.cc` (in `src/electron`) -- adds the `setFrameCap` method, clamped to 30..1000 with 0 or negative meaning uncapped

**macOS GPU crash guard** (macOS only) -- `components/viz/service/frame_sinks/root_compositor_frame_sink_impl.cc`:

- `DisplayDidReceiveCALayerParams()` -- null-check `external_begin_frame_source()` before calling `DidReceiveNewCALayerParams()` on it; it returns null under `--disable-frame-rate-limit`, which otherwise crashes the GPU process on Chromium 150 (`7871`, all of Electron 43.x)

## License

The patch itself is provided as-is. Electron is MIT licensed. Chromium is BSD licensed.
