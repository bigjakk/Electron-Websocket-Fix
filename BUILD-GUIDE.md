# Building Patched Electron: WebSocket/Input Priority Fix

This guide documents how to build a patched Electron binary that fixes a Chromium
regression where continuous mouse input (e.g., shooting in an FPS game) starves
WebSocket and Worker message dispatch when `--disable-frame-rate-limit` is active.

Build instructions are provided for both **Windows** and **Linux**. The patch
itself is platform-agnostic (pure Chromium C++), so the same `.diff` file works
on both platforms.

## Problem

When an Electron app uses `--disable-frame-rate-limit` and `--disable-gpu-vsync`
(common in competitive gaming), continuous mouse input with left-click held down
causes WebSocket messages to freeze for 100-300ms+ at a time. This is because
Chromium's Blink main thread scheduler gives input and compositor tasks the highest
priority, and with no frame rate limit, back-to-back BeginFrame tasks create a
tight loop that permanently starves normal-priority tasks (WebSocket onmessage,
Worker postMessage).

### Root Cause

Three factors combine:

1. **Input tasks at `kHighestPriority`** -- In `ComputePriority()`, input tasks
   get priority level 1 (highest). WebSocket/Worker tasks get `kNormalPriority`
   (level 7).

2. **No cross-priority anti-starvation** -- `task_queue_selector.cc` simply picks
   from the highest active priority queue. It only prevents starvation within the
   same priority level, not across levels.

3. **Compositor priority boost during input** -- When mouse is held + moving
   (`UseCase::kMainThreadCustomInputHandling`), the compositor queue gets boosted
   to `kHighestPriority`. With `--disable-frame-rate-limit`, the
   `BackToBackBeginFrameSource` posts `SEND_BEGIN_MAIN_FRAME` at zero delay,
   creating an infinite loop of highest-priority tasks.

### The Fix

Two changes in `main_thread_scheduler_impl.cc`:

1. Lower input task priority from `kHighestPriority` to `kNormalPriority`
2. Cap compositor priority to `kNormalPriority`

Test results (12-second automated stress test with continuous mouse input):

| Build     | p99 latency | max latency | Messages >50ms |
|-----------|-------------|-------------|----------------|
| Unpatched | ~97ms       | ~308ms      | 8.6%           |
| Patched   | ~34ms       | ~38ms       | 0%             |

---

## Prerequisites

### Windows

- **Windows 11** (10 may work, untested)
- **250GB+ free disk space** (source is ~30GB, build output ~41GB)
- **16GB+ RAM** (64GB recommended)
- **Visual Studio 2022 Build Tools** with:
  - "Desktop development with C++" workload
  - C++ ATL for latest build tools
  - Windows 11 SDK (10.0.26100.0)
- **Git** with long path support
- **Node.js** LTS (v20+)
- **Python 3.11+**

### Linux

- **Ubuntu 22.04+** / **Debian 12+** / **Fedora 38+** (or equivalent)
- **250GB+ free disk space** (source is ~30GB, build output ~41GB)
- **16GB+ RAM** (64GB recommended)
- **Build toolchain**: GCC/G++ or Clang (Chromium provides its own Clang, but
  system compilers are needed for bootstrapping)
- **Git** 2.x+
- **Node.js** LTS (v20+)
- **Python 3.11+**
- **System libraries** (see Linux setup below)

---

## Step 0: Environment Setup

<details>
<summary><strong>Windows Setup</strong></summary>

### Install depot_tools

```bash
cd C:\
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
```

### Install Visual Studio 2022 Build Tools

Download from https://visualstudio.microsoft.com/downloads/ or use winget:

```powershell
winget install "Microsoft.VisualStudio.2022.BuildTools" --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools;includeRecommended --add Microsoft.VisualStudio.Component.VC.ATL --add Microsoft.VisualStudio.Component.Windows11SDK.26100"
```

If you already have Build Tools but need the SDK:

```powershell
winget install "Microsoft.WindowsSDK.10.0.26100"
```

### Install Python 3.12

```powershell
winget install Python.Python.3.12
```

After installing, **disable the Windows Store Python aliases**:
- Settings > Apps > Advanced app settings > App execution aliases
- Turn OFF "python.exe" and "python3.exe" App Installers

Or manually rename the stubs:

```bash
mv "$LOCALAPPDATA/Microsoft/WindowsApps/python.exe" "$LOCALAPPDATA/Microsoft/WindowsApps/python.exe.bak"
mv "$LOCALAPPDATA/Microsoft/WindowsApps/python3.exe" "$LOCALAPPDATA/Microsoft/WindowsApps/python3.exe.bak"
```

Also create a `python3.exe` copy if it doesn't exist:

```bash
cp "$LOCALAPPDATA/Programs/Python/Python312/python.exe" "$LOCALAPPDATA/Programs/Python/Python312/python3.exe"
```

### Configure Git

```bash
git config --global core.longpaths true
git config --global core.autocrlf false
git config --global core.filemode false
git config --global core.fscache true
git config --global core.preloadindex true
git config --global branch.autosetuprebase always
```

### Set Environment Variables

Add to your shell profile or set as system environment variables:

```bash
export DEPOT_TOOLS_WIN_TOOLCHAIN=0
export GIT_CACHE_PATH="C:\\git_cache"
export vs2022_install="C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools"
```

### Configure PATH

Ensure this order (earlier = higher priority):

```
C:\Users\<you>\AppData\Local\Programs\Python\Python312
C:\Users\<you>\AppData\Local\Programs\Python\Python312\Scripts
C:\depot_tools
C:\Program Files\nodejs
```

### Windows Defender Exclusions (Recommended)

Add exclusions for build directories to avoid massive slowdown:

```powershell
Add-MpPreference -ExclusionPath "C:\electron"
Add-MpPreference -ExclusionPath "C:\depot_tools"
```

### Install @electron/build-tools

```bash
npm install -g @electron/build-tools
```

### Create git cache directory

```bash
mkdir C:\git_cache
```

</details>

<details>
<summary><strong>Linux Setup</strong></summary>

### Install system dependencies

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install -y build-essential clang lld gperf pkg-config \
  libdbus-1-dev libgtk-3-dev libnotify-dev libgnome-keyring-dev \
  libgconf2-dev libasound2-dev libcap-dev libcups2-dev libxtst-dev \
  libxss1 libnss3-dev gcc-multilib g++-multilib curl libcurl4-openssl-dev \
  libdrm-dev libgbm-dev mesa-common-dev libpango1.0-dev libpci-dev \
  libx11-xcb-dev libxcomposite-dev libxdamage-dev libxrandr-dev \
  libxkbcommon-dev
```

**Fedora:**

```bash
sudo dnf groupinstall -y "Development Tools" "C Development Tools and Libraries"
sudo dnf install -y clang lld gperf pkgconf-pkg-config dbus-devel gtk3-devel \
  libnotify-devel gnome-keyring-devel alsa-lib-devel libcap-devel cups-devel \
  libXtst-devel nss-devel libcurl-devel libdrm-devel mesa-libgbm-devel \
  pango-devel pciutils-devel libxcb-devel libXcomposite-devel libXdamage-devel \
  libXrandr-devel libxkbcommon-devel
```

**Note:** Chromium's build also runs `build/install-build-deps.sh` during sync,
which installs additional packages. The list above covers the main requirements.

### Install depot_tools

```bash
cd ~
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
```

### Configure environment

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
export PATH="$HOME/depot_tools:$PATH"
export GIT_CACHE_PATH="$HOME/git_cache"
```

Then reload:

```bash
source ~/.bashrc  # or ~/.zshrc
```

### Configure Git

```bash
git config --global core.autocrlf false
git config --global branch.autosetuprebase always
```

### Install Node.js

Use your package manager or nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
```

### Install @electron/build-tools

```bash
npm install -g @electron/build-tools
```

### Create git cache directory

```bash
mkdir -p ~/git_cache
```

</details>

---

## Step 1: Initialize and Sync Source

### Initialize Electron source

**Windows:**

```bash
mkdir C:\electron && cd C:\electron
e init --root=C:\electron krunker-patch --import release
```

**Linux:**

```bash
mkdir -p ~/electron && cd ~/electron
e init --root=$HOME/electron krunker-patch --import release
```

This creates the directory structure and `.gclient` file.

### Sync source (downloads ~30GB)

```bash
e sync
```

This takes 1-3 hours depending on network speed. It downloads Chromium, Node.js,
and all dependencies.

**Linux note:** During sync, Chromium may run `build/install-build-deps.sh` which
requires sudo to install additional system packages. If it doesn't run
automatically, execute it manually:

```bash
cd ~/electron/src
./build/install-build-deps.sh
```

---

## Step 2: Apply the Patch

The file to modify is:

**Windows:** `C:\electron\electron\src\third_party\blink\renderer\platform\scheduler\main_thread\main_thread_scheduler_impl.cc`

**Linux:** `~/electron/src/third_party/blink/renderer/platform/scheduler/main_thread/main_thread_scheduler_impl.cc`

### Patch 1: Input Priority (in `ComputePriority()` function)

Find this code (around line 2757):

```cpp
case MainThreadTaskQueue::QueueTraits::PrioritisationType::kInput:
  return TaskPriority::kHighestPriority;
```

Replace with:

```cpp
case MainThreadTaskQueue::QueueTraits::PrioritisationType::kInput:
  // Lowered from kHighestPriority to kNormalPriority to prevent input
  // tasks from starving WebSocket/Worker message dispatch when
  // --disable-frame-rate-limit is active. Without cross-priority
  // anti-starvation in the task queue selector, ANY priority above
  // kNormalPriority causes starvation during continuous mouse input.
  // Testing shows kNormalPriority actually improves both frame rate
  // and input throughput vs kHighestPriority, because it prevents the
  // input->compositor priority cascade from monopolizing the thread.
  return TaskPriority::kNormalPriority;
```

### Patch 2: Compositor Priority Cap (in `ComputeCompositorPriority()` function)

Find the `ComputeCompositorPriority()` function (around line 2823). Replace the
entire function body. The original looks like:

```cpp
TaskPriority MainThreadSchedulerImpl::ComputeCompositorPriority() const {
  std::optional<TaskPriority> targeted_main_frame_priority =
      ComputeCompositorPriorityForMainFrame();
  std::optional<TaskPriority> use_case_priority =
      ComputeCompositorPriorityFromUseCase();
  if (!targeted_main_frame_priority && !use_case_priority) {
    return TaskPriority::kNormalPriority;
  } else if (!use_case_priority) {
    return *targeted_main_frame_priority;
  } else if (!targeted_main_frame_priority) {
    return *use_case_priority;
  }

  // Both are set, so some reconciliation is needed.
  CHECK(targeted_main_frame_priority && use_case_priority);
  // If either votes for the highest priority, use that to simplify the
  // remaining case.
  if (*targeted_main_frame_priority == TaskPriority::kHighestPriority ||
      *use_case_priority == TaskPriority::kHighestPriority) {
    return TaskPriority::kHighestPriority;
  }
  // Otherwise, this must be a combination of UseCase::kCompositorGesture and
  // rendering starvation since all other use cases set the priority to highest.
  CHECK(current_use_case() == UseCase::kCompositorGesture &&
        (main_thread_only().main_frame_prioritization_state ==
             RenderingPrioritizationState::kRenderingStarved ||
         main_thread_only().main_frame_prioritization_state ==
             RenderingPrioritizationState::kRenderingStarvedByRenderBlocking));
  CHECK_LE(*targeted_main_frame_priority, *use_case_priority);
  return *targeted_main_frame_priority;
}
```

Replace with:

```cpp
TaskPriority MainThreadSchedulerImpl::ComputeCompositorPriority() const {
  std::optional<TaskPriority> targeted_main_frame_priority =
      ComputeCompositorPriorityForMainFrame();
  std::optional<TaskPriority> use_case_priority =
      ComputeCompositorPriorityFromUseCase();

  TaskPriority result;
  if (!targeted_main_frame_priority && !use_case_priority) {
    result = TaskPriority::kNormalPriority;
  } else if (!use_case_priority) {
    result = *targeted_main_frame_priority;
  } else if (!targeted_main_frame_priority) {
    result = *use_case_priority;
  } else {
    // Both are set -- take the higher priority (lower numeric value).
    result = std::min(*targeted_main_frame_priority, *use_case_priority);
  }

  // Cap compositor priority to kNormalPriority. Without this cap,
  // back-to-back BeginFrame tasks at kHighestPriority (triggered by
  // continuous mouse input + --disable-frame-rate-limit) create a tight
  // compositor loop that permanently starves kNormalPriority tasks
  // (WebSocket onmessage, Worker postMessage). The task queue selector
  // has no cross-priority anti-starvation, so any priority above kNormal
  // causes indefinite deferral of lower-priority work. Rendering starvation
  // detection in ComputeCompositorPriorityForMainFrame() is sufficient to
  // protect against actual frame drops when compositor priority is capped.
  return std::max(result, TaskPriority::kNormalPriority);
}
```

### Using the diff file

Alternatively, if you have the `.diff` file, apply it from the Chromium src root:

**Windows:**

```bash
cd C:\electron\electron\src
git apply /path/to/ws-priority-patch.diff
```

**Linux:**

```bash
cd ~/electron/src
git apply /path/to/ws-priority-patch.diff
```

### Verify the patch

**Windows:**

```bash
cd C:\electron\electron\src
grep -n "kNormalPriority" third_party/blink/renderer/platform/scheduler/main_thread/main_thread_scheduler_impl.cc | grep -E "(kInput|std::max)"
```

**Linux:**

```bash
cd ~/electron/src
grep -n "kNormalPriority" third_party/blink/renderer/platform/scheduler/main_thread/main_thread_scheduler_impl.cc | grep -E "(kInput|std::max)"
```

You should see the `kInput` case returning `kNormalPriority` and the `std::max`
cap at the end of `ComputeCompositorPriority()`.

---

## Step 3: Configure the Release Build

### Set up args.gn

**Windows:**

```bash
mkdir -p C:\electron\electron\src\out\Release
```

**Linux:**

```bash
mkdir -p ~/electron/src/out/Release
```

Create/edit `out/Release/args.gn`:

```gn
import("//electron/build/args/release.gn")
is_official_build = true
use_remoteexec = false
use_reclient = false
```

### Generate build files

**Windows:**

```bash
cd C:\electron\electron\src
buildtools/win/gn.exe gen out/Release
```

**Linux:**

```bash
cd ~/electron/src
buildtools/linux64/gn gen out/Release
```

You should see: `Done. Made XXXXX targets from XXXX files`

### Clean stale state (if needed)

If you see an error about Siso state files:

**Windows:**

```bash
buildtools/win/gn.exe clean out/Release
buildtools/win/gn.exe gen out/Release
```

**Linux:**

```bash
buildtools/linux64/gn clean out/Release
buildtools/linux64/gn gen out/Release
```

---

## Step 4: Build

**Windows:**

```bash
cd C:\electron\electron\src
ninja -C out/Release electron
```

**Linux:**

```bash
cd ~/electron/src
ninja -C out/Release electron
```

This is a full rebuild -- **expect 6-10+ hours** depending on CPU cores and speed.
On a 24-core machine with 64GB RAM it takes approximately 8-9 hours (~45,000 build
steps).

### Build the distribution zip

After the main build completes:

```bash
ninja -C out/Release electron:electron_dist_zip
```

**Windows:** The dist zip will be at `C:\electron\electron\src\out\Release\dist.zip` (~137MB).

**Linux:** The dist zip will be at `~/electron/src/out/Release/dist.zip` (~130MB).

---

## Step 5: Using the Patched Electron

### Option A: Direct binary

Run your app directly with the built electron:

**Windows:**

```bash
C:\electron\electron\src\out\Release\electron.exe /path/to/your/app
```

**Linux:**

```bash
~/electron/src/out/Release/electron /path/to/your/app
```

### Option B: Replace in node_modules

Extract `dist.zip` and replace the Electron binary in your project:

```bash
# Find your project's electron installation
ls node_modules/electron/dist/

# Back up the original
mv node_modules/electron/dist node_modules/electron/dist-original

# Extract patched version
mkdir node_modules/electron/dist
cd node_modules/electron/dist
unzip /path/to/dist.zip
```

### Option C: electron-builder / electron-forge

Point your build tool to the custom Electron zip:

**electron-builder** (`package.json`):
```json
{
  "build": {
    "electronDist": "path/to/extracted/dist",
    "electronVersion": "40.6.1"
  }
}
```

Or set the environment variable:
```bash
export ELECTRON_CUSTOM_DIR=path/to/extracted/dist
```

**electron-forge** (`forge.config.js`):
```js
module.exports = {
  packagerConfig: {
    electronZipDir: 'path/to/extracted/dist'
  }
};
```

### Required Chromium flags

Your Electron app should use these flags for unlimited FPS:

```javascript
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
```

---

## Verification: Automated Stress Test

### Test files

Create a directory (e.g., `C:\electron\test-app`) with these files:

**package.json:**
```json
{
  "name": "ws-starvation-test",
  "version": "1.0.0",
  "main": "cdp-test.js",
  "dependencies": {
    "ws": "^8.0.0"
  }
}
```

Run `npm install` in the test directory.

**stress.html:**
```html
<!DOCTYPE html>
<html>
<head><title>WS Starvation Stress Test</title></head>
<body style="margin:0; overflow:hidden; background:#111;">
<canvas id="c" style="width:100vw;height:100vh;display:block;"></canvas>
<div id="hud" style="position:fixed;top:10px;left:10px;color:#0f0;font:14px monospace;background:rgba(0,0,0,0.8);padding:10px;z-index:10;pointer-events:none;"></div>
<script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const hud = document.getElementById('hud');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let mx = canvas.width/2, my = canvas.height/2;
    let mouseDown = false;
    let moveCount = 0;
    let frameCount = 0;

    document.addEventListener('mousedown', (e) => {
        mouseDown = true;
        mx = e.clientX; my = e.clientY;
        ctx.fillStyle = '#ff0';
        ctx.beginPath();
        ctx.arc(mx, my, 30, 0, Math.PI*2);
        ctx.fill();
    });
    document.addEventListener('mouseup', () => { mouseDown = false; });
    document.addEventListener('mousemove', (e) => {
        mx = e.clientX; my = e.clientY;
        moveCount++;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = mouseDown ? '#f00' : '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mx - 20, my); ctx.lineTo(mx + 20, my);
        ctx.moveTo(mx, my - 20); ctx.lineTo(mx, my + 20);
        ctx.stroke();
        if (mouseDown) {
            for (let i = 0; i < 5; i++) {
                const hue = Math.floor(Math.random()*60);
                ctx.fillStyle = 'hsl(' + hue + ', 100%, 50%)';
                ctx.fillRect(mx + Math.random()*60-30, my + Math.random()*60-30, 3, 3);
            }
        }
    });

    function frame() {
        frameCount++;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    let wsLatencies = [];
    const ws = new WebSocket('ws://' + location.host);
    ws.onmessage = function(e) {
        const now = performance.now();
        if (ws._lastReceive) {
            wsLatencies.push(now - ws._lastReceive);
        }
        ws._lastReceive = now;
    };

    setInterval(function() {
        if (wsLatencies.length < 2) return;
        const recent = wsLatencies.slice(-300);
        const sorted = recent.slice().sort(function(a,b) { return a - b; });
        const avg = recent.reduce(function(a,b) { return a+b; }, 0) / recent.length;
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        const max = sorted[sorted.length - 1];
        const over50 = recent.filter(function(x) { return x > 50; }).length;
        hud.textContent =
            'Mouse: ' + (mouseDown ? 'SHOOTING' : 'idle') + ' (' + moveCount + ' moves)\n' +
            'Frames: ' + frameCount + '\n' +
            'WS: avg=' + avg.toFixed(1) + ' p95=' + p95.toFixed(1) + ' p99=' + p99.toFixed(1) + ' max=' + max.toFixed(1) + '\n' +
            'WS >50ms: ' + over50 + '/' + recent.length + ' (' + (over50/recent.length*100).toFixed(1) + '%)';
    }, 250);
</script>
</body>
</html>
```

**cdp-test.js:**
```javascript
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2] || '8085');
const LABEL = process.argv[3] || 'TEST';
const TEST_DURATION_MS = 12000;
const WARMUP_MS = 3000;

app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

// Server
const server = http.createServer((req, res) => {
    const filePath = path.join(__dirname, 'stress.html');
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
    });
});
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
    console.log('[' + LABEL + '] WS client connected');
    const interval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ t: performance.now() }));
        }
    }, 16);
    ws.on('close', () => clearInterval(interval));
});
server.listen(PORT, () => console.log('[' + LABEL + '] Server on port ' + PORT));

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 900, height: 700, show: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await win.loadURL('http://localhost:' + PORT);
    const wc = win.webContents;

    // Attach to debugger for CDP input dispatch
    wc.debugger.attach('1.3');
    console.log('[' + LABEL + '] CDP debugger attached');

    await new Promise(r => setTimeout(r, WARMUP_MS));
    await wc.executeJavaScript('wsLatencies = []; void 0;');

    console.log('[' + LABEL + '] Starting ' + (TEST_DURATION_MS/1000) + 's stress test...');

    const startTime = Date.now();
    let eventCount = 0;
    let angle = 0;
    const centerX = 450, centerY = 350;

    // Mouse down via CDP
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: centerX, y: centerY,
        button: 'left',
        clickCount: 1
    });
    eventCount++;

    // Flood with mouseMoved events via CDP
    const flood = async () => {
        while (Date.now() - startTime < TEST_DURATION_MS) {
            const promises = [];
            for (let i = 0; i < 10; i++) {
                angle += 0.03;
                const radius = 100 + Math.sin(angle * 0.5) * 60;
                const x = Math.floor(centerX + Math.cos(angle) * radius);
                const y = Math.floor(centerY + Math.sin(angle) * radius);
                promises.push(
                    wc.debugger.sendCommand('Input.dispatchMouseEvent', {
                        type: 'mouseMoved',
                        x: x, y: y,
                        button: 'left',
                        buttons: 1
                    }).catch(() => {})
                );
                eventCount++;
            }
            await Promise.all(promises);
        }
    };

    await flood();

    // Release
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: centerX, y: centerY,
        button: 'left'
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 2000));

    // Collect results
    const result = await wc.executeJavaScript(
        '(function() {' +
        '  if (!wsLatencies || wsLatencies.length === 0) return JSON.stringify({ error: "no data" });' +
        '  var sorted = wsLatencies.slice().sort(function(a,b){return a-b});' +
        '  var len = sorted.length;' +
        '  var avg = wsLatencies.reduce(function(a,b){return a+b},0) / len;' +
        '  var p50 = sorted[Math.floor(len*0.50)];' +
        '  var p75 = sorted[Math.floor(len*0.75)];' +
        '  var p90 = sorted[Math.floor(len*0.90)];' +
        '  var p95 = sorted[Math.floor(len*0.95)];' +
        '  var p99 = sorted[Math.floor(len*0.99)];' +
        '  var max = sorted[len-1];' +
        '  var min = sorted[0];' +
        '  var over50 = wsLatencies.filter(function(x){return x>50}).length;' +
        '  var over100 = wsLatencies.filter(function(x){return x>100}).length;' +
        '  var over200 = wsLatencies.filter(function(x){return x>200}).length;' +
        '  var over500 = wsLatencies.filter(function(x){return x>500}).length;' +
        '  var mouseEvents = typeof moveCount !== "undefined" ? moveCount : -1;' +
        '  var frames = typeof frameCount !== "undefined" ? frameCount : -1;' +
        '  return JSON.stringify({avg:avg,min:min,p50:p50,p75:p75,p90:p90,p95:p95,p99:p99,max:max,total:len,over50:over50,over100:over100,over200:over200,over500:over500,mouseEvents:mouseEvents,frames:frames});' +
        '})()'
    );

    wc.debugger.detach();

    const d = JSON.parse(result);
    if (d.error) {
        console.log('[' + LABEL + '] ERROR: ' + d.error);
        process.exit(2);
    }

    console.log('\n[' + LABEL + '] ============ RESULTS ============');
    console.log('[' + LABEL + '] CDP events sent: ' + eventCount);
    console.log('[' + LABEL + '] Mouse events received by renderer: ' + d.mouseEvents);
    console.log('[' + LABEL + '] RAF frames rendered: ' + d.frames);
    console.log('[' + LABEL + '] WS samples collected: ' + d.total);
    console.log('[' + LABEL + ']');
    console.log('[' + LABEL + '] WS inter-message latency (ms):');
    console.log('[' + LABEL + ']   min:  ' + d.min.toFixed(1));
    console.log('[' + LABEL + ']   avg:  ' + d.avg.toFixed(1));
    console.log('[' + LABEL + ']   p50:  ' + d.p50.toFixed(1));
    console.log('[' + LABEL + ']   p75:  ' + d.p75.toFixed(1));
    console.log('[' + LABEL + ']   p90:  ' + d.p90.toFixed(1));
    console.log('[' + LABEL + ']   p95:  ' + d.p95.toFixed(1));
    console.log('[' + LABEL + ']   p99:  ' + d.p99.toFixed(1));
    console.log('[' + LABEL + ']   max:  ' + d.max.toFixed(1));
    console.log('[' + LABEL + ']');
    console.log('[' + LABEL + '] Threshold violations:');
    console.log('[' + LABEL + ']   >50ms:  ' + d.over50 + ' / ' + d.total + ' (' + (d.over50/d.total*100).toFixed(1) + '%)');
    console.log('[' + LABEL + ']   >100ms: ' + d.over100 + ' / ' + d.total + ' (' + (d.over100/d.total*100).toFixed(1) + '%)');
    console.log('[' + LABEL + ']   >200ms: ' + d.over200 + ' / ' + d.total + ' (' + (d.over200/d.total*100).toFixed(1) + '%)');
    console.log('[' + LABEL + ']   >500ms: ' + d.over500 + ' / ' + d.total + ' (' + (d.over500/d.total*100).toFixed(1) + '%)');
    console.log('[' + LABEL + '] ==================================');

    process.exit(0);
});
```

### Running the test

**Windows:**

```bash
# Test the patched build
C:\electron\electron\src\out\Release\electron.exe cdp-test.js 8085 PATCHED

# Compare against a stock Electron (download from https://github.com/electron/electron/releases)
path\to\stock\electron.exe cdp-test.js 8086 BASELINE
```

**Linux:**

```bash
# Test the patched build
~/electron/src/out/Release/electron cdp-test.js 8085 PATCHED

# Compare against a stock Electron (download from https://github.com/electron/electron/releases)
path/to/stock/electron cdp-test.js 8086 BASELINE
```

**Expected results:**
- Unpatched: p99 ~80-100ms, max ~200-300ms, 5-9% of messages >50ms
- Patched: p99 ~30-35ms, max ~35-40ms, 0% of messages >50ms

**Important:** The test uses CDP `Input.dispatchMouseEvent` to simulate mouse
input. This goes through the full Chromium input pipeline and reliably triggers
the starvation. Electron's `sendInputEvent` API does NOT trigger it (bypasses
compositor thread input handler).

---

## Rebuilding for a Different Electron Version

To build the patch against a different Electron version (e.g., upgrading to a
newer stable release):

**Windows:**

```bash
cd C:\electron\electron\src\electron

# List available stable versions
git tag --list 'v*' --sort=-version:refname | grep -v -E '(nightly|alpha|beta)' | head -10

# Check out the desired version
git checkout v40.6.1

# Sync dependencies (30-60+ minutes)
cd C:\electron\electron\src
gclient sync --with_branch_heads --with_tags

# Re-apply the patch (line numbers may differ between versions)
# Edit main_thread_scheduler_impl.cc as described in Step 2
# Or try: git apply ws-priority-patch.diff

# Clean, generate, and build
buildtools/win/gn.exe clean out/Release
buildtools/win/gn.exe gen out/Release
ninja -C out/Release electron
ninja -C out/Release electron:electron_dist_zip
```

**Linux:**

```bash
cd ~/electron/src/electron

# List available stable versions
git tag --list 'v*' --sort=-version:refname | grep -v -E '(nightly|alpha|beta)' | head -10

# Check out the desired version
git checkout v40.6.1

# Sync dependencies (30-60+ minutes)
cd ~/electron/src
gclient sync --with_branch_heads --with_tags

# Re-apply the patch (line numbers may differ between versions)
# Edit main_thread_scheduler_impl.cc as described in Step 2
# Or try: git apply ws-priority-patch.diff

# Clean, generate, and build
buildtools/linux64/gn clean out/Release
buildtools/linux64/gn gen out/Release
ninja -C out/Release electron
ninja -C out/Release electron:electron_dist_zip
```

**Note:** The patch modifies Chromium source (not Electron source), so line numbers
may shift between versions. The function names and structure should remain the same
across Chromium versions. Search for `PrioritisationType::kInput` and
`ComputeCompositorPriority()` to find the right locations.

---

## Patch File

The raw diff is saved at `ws-priority-patch.diff` alongside this guide. It was
generated against Chromium 147.x (Electron v42 nightly) but the same logic applies
to all recent versions.

---

## Troubleshooting

### Windows

#### "Python was not found" during build
Disable Windows Store Python aliases (see Step 0). Ensure real Python 3.12 is
in PATH before `C:\Users\<you>\AppData\Local\Microsoft\WindowsApps`.

#### "gn not found"
Use the full path: `buildtools/win/gn.exe` from the Chromium src directory.

#### Build fails with missing Windows SDK
Install SDK 10.0.26100.0: `winget install "Microsoft.WindowsSDK.10.0.26100"`

### Linux

#### Missing system libraries during build
Run the Chromium dependency installer:

```bash
cd ~/electron/src
./build/install-build-deps.sh
```

This installs all required system packages. You may need `--no-prompt` for
non-interactive use.

#### "gn not found"
Use the full path: `buildtools/linux64/gn` from the Chromium src directory.

#### Build fails with "file not found" errors for system headers
Ensure you have the development packages installed. On Ubuntu/Debian:

```bash
sudo apt install -y libgtk-3-dev libnss3-dev libasound2-dev libxtst-dev
```

#### Electron binary doesn't launch (missing shared libraries)
Check which libraries are missing:

```bash
ldd ~/electron/src/out/Release/electron | grep "not found"
```

Install the missing packages with your system package manager.

### Both Platforms

#### "Siso state file" error when running ninja
Clean and regenerate:
- **Windows:** `buildtools/win/gn.exe clean out/Release` then `gn gen` again
- **Linux:** `buildtools/linux64/gn clean out/Release` then `gn gen` again

#### gclient sync fails with SSH errors
The sync uses Git cache. If SSH keys aren't set up for GitHub, the repos should
still sync via HTTPS through the cache. If errors persist, check `GIT_CACHE_PATH`
is set correctly.

#### Patch doesn't apply cleanly to a different version
Apply manually -- search for `PrioritisationType::kInput` returning
`kHighestPriority` and change it to `kNormalPriority`. Then find
`ComputeCompositorPriority()` and add the `std::max` cap. The surrounding code
structure should be recognizable even if line numbers differ.
