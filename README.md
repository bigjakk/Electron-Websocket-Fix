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

The latest builds apply **two complementary patches**:

### 1. Input priority (this project)

Two changes in `main_thread_scheduler_impl.cc`:

1. **Lower input task priority** from `kHighestPriority` to `kNormalPriority`
2. **Cap compositor priority** to `kNormalPriority` via `std::max()`

This stops continuous mouse input from starving WebSocket/Worker message dispatch. See [`patches/ws-priority-patch.diff`](patches/ws-priority-patch.diff) for the exact diff.

### 2. Frame pacing ([thegu5](https://github.com/thegu5))

A one-line change to `IsDrawThrottled()` in `cc/scheduler/scheduler_state_machine.cc`:

```diff
-  return pending_submit_frames_ >= kMaxPendingSubmitFrames &&
-         !settings_.disable_frame_rate_limit;
+  return pending_submit_frames_ >= kMaxPendingSubmitFrames;
```

Removing the `!settings_.disable_frame_rate_limit` term re-enables frame throttling even when `--disable-frame-rate-limit` is set, so the `BackToBackBeginFrameSource` can no longer flood the main thread with zero-delay `SEND_BEGIN_MAIN_FRAME` tasks (root-cause factor 3 above). See [`patches/frame-pacing-patch.diff`](patches/frame-pacing-patch.diff), from thegu5's Electron commit [`733d1c2`](https://github.com/electron/electron/commit/733d1c2cdab84ebc252d4f672b3527a1fc73bd01).

### Test Results

12-second automated stress test with continuous CDP mouse input (left-click held, circular movement):

| Build | p99 Latency | Max Latency | Messages >50ms | Mouse Events | Frames |
|-------|-------------|-------------|----------------|-------------|--------|
| **Unpatched** | ~97ms | ~308ms | 8.6% | ~11,380 | ~6,300 |
| **Patched** | ~34ms | ~38ms | **0%** | ~12,360 | ~7,620 |

The patch not only eliminates starvation but actually **improves** both input throughput (+9% mouse events) and frame rate (+21% frames) because it prevents the input/compositor priority cascade from monopolizing the main thread.

_The numbers above reflect the input-priority patch (the WebSocket-starvation fix). The frame-pacing patch is a complementary change that throttles runaway frame generation under `--disable-frame-rate-limit`._

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

# 4. Apply patches
git apply path/to/ws-priority-patch.diff     # input priority (this repo)
git apply path/to/frame-pacing-patch.diff    # frame pacing (thegu5)

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

Both patches modify Chromium source (not Electron source), so they apply to any Electron version since Electron 10 (Chromium 84+) on any platform (Windows, Linux, macOS). Line numbers may shift between versions but the function names remain the same.

**Input priority** -- `third_party/blink/renderer/platform/scheduler/main_thread/main_thread_scheduler_impl.cc`:

- `ComputePriority()` -- search for `PrioritisationType::kInput`
- `ComputeCompositorPriority()` -- search for that function name

**Frame pacing** -- `cc/scheduler/scheduler_state_machine.cc`:

- `IsDrawThrottled()` -- remove the `!settings_.disable_frame_rate_limit` term from the throttle condition

## License

The patch itself is provided as-is. Electron is MIT licensed. Chromium is BSD licensed.
