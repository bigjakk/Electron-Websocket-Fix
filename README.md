# Electron WebSocket Fix

Patched Electron builds that fix a Chromium regression where continuous mouse input starves WebSocket and Worker message dispatch when `--disable-frame-rate-limit` is active.

This is critical for competitive browser-based games (like [Krunker](https://krunker.io)) running in Electron, where shooting (holding left click + moving mouse) causes network freezes of 100-300ms+.

## Downloads

Pre-built patched binaries (Windows x64):

| File | Electron Version | Size |
|------|-----------------|------|
| [`electron-v40.6.1-release-patched-win32-x64.zip`](releases/electron-v40.6.1-release-patched-win32-x64.zip) | v40.6.1 (latest stable) | 133MB |
| [`electron-v42.0.0-nightly-release-patched-win32-x64.zip`](releases/electron-v42.0.0-nightly-release-patched-win32-x64.zip) | v42.0.0-nightly | 137MB |

Both are full release builds (`is_official_build = true`) with maximum optimizations.

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

Two changes in one file (`main_thread_scheduler_impl.cc`):

1. **Lower input task priority** from `kHighestPriority` to `kNormalPriority`
2. **Cap compositor priority** to `kNormalPriority` via `std::max()`

See [`patches/ws-priority-patch.diff`](patches/ws-priority-patch.diff) for the exact diff.

### Test Results

12-second automated stress test with continuous CDP mouse input (left-click held, circular movement):

| Build | p99 Latency | Max Latency | Messages >50ms | Mouse Events | Frames |
|-------|-------------|-------------|----------------|-------------|--------|
| **Unpatched** | ~97ms | ~308ms | 8.6% | ~11,380 | ~6,300 |
| **Patched** | ~34ms | ~38ms | **0%** | ~12,360 | ~7,620 |

The patch not only eliminates starvation but actually **improves** both input throughput (+9% mouse events) and frame rate (+21% frames) because it prevents the input/compositor priority cascade from monopolizing the main thread.

## Usage

### Option A: Direct Binary

Extract the zip and run your app:

```bash
electron.exe path/to/your/app
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
path/to/patched/electron.exe cdp-test.js 8085 PATCHED
```

The test uses CDP `Input.dispatchMouseEvent` to simulate continuous mouse input (the only reliable automated method -- Electron's `sendInputEvent` API bypasses the compositor thread and doesn't trigger the bug).

Expected output for a patched build: **0% of WebSocket messages >50ms**.

## Building From Source

Full build instructions are in [`BUILD-GUIDE.md`](BUILD-GUIDE.md).

Quick summary:

```bash
# 1. Set up environment (depot_tools, VS Build Tools, Python, etc.)
# 2. Initialize and sync Electron source
e init --root=C:\electron my-build --import release
e sync

# 3. Check out desired version
cd src/electron && git checkout v40.6.1
cd .. && gclient sync --with_branch_heads --with_tags

# 4. Apply patch
git apply path/to/ws-priority-patch.diff

# 5. Configure and build
mkdir -p out/Release
# Set out/Release/args.gn:
#   import("//electron/build/args/release.gn")
#   is_official_build = true
#   use_remoteexec = false
#   use_reclient = false
buildtools/win/gn.exe gen out/Release
ninja -C out/Release electron
ninja -C out/Release electron:electron_dist_zip
```

Expect 6-10+ hours for a full build on a modern machine (24 cores, 64GB RAM).

## Patch Details

The patch modifies Chromium source (not Electron source), so it applies to any Electron version. Line numbers may shift between versions but the function names remain the same:

- `ComputePriority()` -- search for `PrioritisationType::kInput`
- `ComputeCompositorPriority()` -- search for that function name

File: `third_party/blink/renderer/platform/scheduler/main_thread/main_thread_scheduler_impl.cc`

## License

The patch itself is provided as-is. Electron is MIT licensed. Chromium is BSD licensed.
