// In-game comparison harness: loads Krunker with the switches the client ships
// with and records how long every frame took while you play, so the same
// session can be repeated on another build or with the series' switches on.
// Driver: ../run-krunker-ab.ps1.
//
// Environment:
//   KCC_AB_LABEL       name of this run in the result files (control, off, on).
//   KCC_AB_OUT         folder for the result files (required).
//   KCC_AB_FEATURES    comma-separated --enable-features list ('' = none).
//   KCC_AB_JS_FLAGS    value for --js-flags ('' = none).
//   KCC_AB_FRAME_CAP   cap that F9 switches on and off (default 240).
//   KCC_AB_FULLSCREEN  1 = fullscreen window.
//   KCC_AB_MINUTES     quit after N minutes (0 = never).
//   KCC_AB_URL         page to load (default https://krunker.io/).
//   KCC_AB_RAW_INPUT   0 = do not ask for raw mouse movement. Default: ask
//                      for it on Windows, as the client does (preload.js).
//   KCC_AB_SCREENSHOT  1 = save a picture of the window next to the results
//                      when the run ends (it shows the account name).
//
// Keys: F9 toggles the frame cap, F10 quits and writes the results. Closing
// the window does the same.
//
// What is measured: the interval between requestAnimationFrame callbacks in
// the page, i.e. the rate the game renders at. Intervals are kept apart by
// whether the pointer was locked (in a match) and by whether the cap was on.
// The page's clock is coarsened to 0.1 ms, so single intervals carry that
// error; counts over time (the average rate) do not.
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const rawInput = process.platform === 'win32' && process.env.KCC_AB_RAW_INPUT !== '0';
const label = (process.env.KCC_AB_LABEL || 'run').replace(/[^A-Za-z0-9_.-]/g, '_');
const outDir = process.env.KCC_AB_OUT || '';
const features = (process.env.KCC_AB_FEATURES || '').trim();
const jsFlags = (process.env.KCC_AB_JS_FLAGS || '').trim();
const frameCap = Number(process.env.KCC_AB_FRAME_CAP || 240);
const minutes = Number(process.env.KCC_AB_MINUTES || 0);
const url = process.env.KCC_AB_URL || 'https://krunker.io/';

if (!outDir) {
  console.error('[kcc-ab] KCC_AB_OUT is not set');
  process.exit(2);
}

// The switches the client ships with at its default settings (FPS unlocked,
// high-performance GPU, "remove useless features" on, "extra performance
// tweaks" off). Keep in step with applyPlatformFlags() in KCC's platform.ts
// (and with ../../pgo/krunker-train/main.js).
const sw = (name, value) => app.commandLine.appendSwitch(name, value);
const disabled = ['MediaRouter'];
sw('disable-frame-rate-limit');
sw('disable-gpu-vsync');
sw('max-gum-fps', '9999');
sw('disable-backgrounding-occluded-windows');
sw('disable-background-timer-throttling');
sw('disable-renderer-backgrounding');
sw('autoplay-policy', 'no-user-gesture-required');
sw('overscroll-history-navigation', '0');
sw('pull-to-refresh', '0');
sw('ignore-gpu-blocklist');
sw('force-high-performance-gpu');
sw('disable-breakpad');
sw('disable-logging');
sw('disable-hang-monitor');
sw('disable-2d-canvas-clip-aa');
sw('disable-gpu-process-for-dx12-info-collection');
if (process.platform === 'win32') {
  sw('use-angle', 'd3d11');
  disabled.push('CalculateNativeWinOcclusion', 'HardwareMediaKeyHandling');
} else if (process.platform === 'darwin') {
  disabled.push('VSyncAlignedPresentationForScrolling', 'VSyncAlignedPresent');
} else {
  // --ozone-platform=x11 has to be on the command line: Chromium reads it
  // before this script runs.
  sw('ozone-platform-hint', 'auto');
  sw('disable-gpu-sandbox');
  sw('disable-accelerated-video-decode');
  sw('disable-accelerated-video-encode');
  sw('disable-accelerated-mjpeg-decode');
}
sw('disable-features', disabled.join(','));
if (features) sw('enable-features', features);
if (jsFlags) sw('js-flags', jsFlags);

// Krunker treats a user agent that names Electron differently from a browser.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/i, '')
  .replace(/\skcc-ab-harness\/\S+/i, '');

// Runs in the page: one extra requestAnimationFrame callback per frame that
// stores the interval since the previous one. Nothing of the page is changed.
const RECORDER = `(() => {
  if (window.__kccAb) return true;
  let locked = [], unlocked = [], last = 0;
  const tick = () => {
    // The time the callback really runs, not the frame's nominal time.
    const t = performance.now();
    if (last) (document.pointerLockElement ? locked : unlocked).push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__kccAb = { take() { const r = { locked, unlocked }; locked = []; unlocked = []; return r; } };
  return true;
})()`;

// Pointer locks the page was granted, as preload.js reports them.
const locks = { raw: 0, notRaw: 0 };
ipcMain.on('kcc-raw-lock', (_event, raw) => { locks[raw ? 'raw' : 'notRaw']++; });

let win = null;
let capped = false;
let done = false;
let poll = null;
const startedAt = Date.now();
// intervals[capState][lockState] = array of frame intervals in ms
const intervals = { uncapped: { locked: [], unlocked: [] }, capped: { locked: [], unlocked: [] } };
const windows = [];

function stats(list) {
  const n = list.length;
  if (!n) return { frames: 0 };
  const sorted = Float64Array.from(list).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const pct = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
  const round = (x, d = 2) => Number(x.toFixed(d));
  return {
    frames: n,
    seconds: round(sum / 1000, 1),
    avgFps: round(n / (sum / 1000), 1),
    p50Ms: round(pct(0.5)),
    p99Ms: round(pct(0.99)),
    p999Ms: round(pct(0.999)),
    low1PctFps: round(1000 / pct(0.99), 1),
    low01PctFps: round(1000 / pct(0.999), 1),
    maxMs: round(sorted[n - 1]),
    over8msPerMin: round(sorted.filter((x) => x > 8.34).length / (sum / 60000), 1),
    over16msPerMin: round(sorted.filter((x) => x > 16.7).length / (sum / 60000), 1)
  };
}

async function pull() {
  if (!win || win.isDestroyed()) return;
  let r = null;
  try {
    r = await win.webContents.executeJavaScript('window.__kccAb ? window.__kccAb.take() : null', true);
  } catch { return; }  // navigating
  if (!r) return;
  const state = capped ? 'capped' : 'uncapped';
  for (const lock of ['locked', 'unlocked']) {
    const src = r[lock] || [];
    const dst = intervals[state][lock];
    for (let i = 0; i < src.length; i++) dst.push(src[i]);
  }
  const s = stats(r.locked && r.locked.length ? r.locked : r.unlocked || []);
  if (s.frames) {
    windows.push({ t: Number(((Date.now() - startedAt) / 1000).toFixed(1)), cap: state, inMatch: !!(r.locked && r.locked.length), fps: s.avgFps, p99Ms: s.p99Ms, maxMs: s.maxMs });
  }
}

function setCap(on) {
  // Close the open measurement window under the old cap state first.
  pull().finally(() => {
    capped = on;
    if (win && typeof win.setFrameCap === 'function') {
      win.setFrameCap(on ? frameCap : 0);
      console.log(`[kcc-ab] frame cap ${on ? frameCap : 'off'}`);
    } else {
      console.log('[kcc-ab] win.setFrameCap is not available in this build');
      capped = false;
    }
  });
}

async function finish(reason) {
  if (done) return;
  done = true;
  clearInterval(poll);
  await pull();
  const result = {
    label,
    finished: new Date().toISOString(),
    reason,
    url,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, v8: process.versions.v8 },
    features,
    jsFlags,
    frameCap,
    fullscreen: process.env.KCC_AB_FULLSCREEN === '1',
    rawInput: { askedFor: rawInput, rawLocks: locks.raw, notRawLocks: locks.notRaw },
    note: 'intervals between requestAnimationFrame callbacks; low1PctFps = 1000 / 99th-percentile interval',
    inMatch: { uncapped: stats(intervals.uncapped.locked), capped: stats(intervals.capped.locked) },
    outOfMatch: { uncapped: stats(intervals.uncapped.unlocked), capped: stats(intervals.capped.unlocked) },
    windows
  };
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(outDir, `ab-${label}-${stamp}.json`);
  if (process.env.KCC_AB_SCREENSHOT === '1' && win && !win.isDestroyed()) {
    // What was on screen at the end, taken after the last measurement.
    try {
      const shot = await win.webContents.capturePage();
      const name = `ab-${label}-${stamp}.jpg`;
      fs.writeFileSync(path.join(outDir, name), shot.resize({ width: 1280 }).toJPEG(80));
      result.screenshot = name;
    } catch (e) {
      result.screenshot = `failed: ${e.message}`;
    }
  }
  fs.writeFileSync(file, JSON.stringify(result, null, 1));
  const line = (name, s) => s.frames
    ? `${name}: ${s.avgFps} fps avg, 1% low ${s.low1PctFps}, 0.1% low ${s.low01PctFps}, worst frame ${s.maxMs} ms, ${s.seconds} s`
    : `${name}: no frames`;
  const text = [
    `[kcc-ab] ${label}  electron ${process.versions.electron}  ${features ? 'switches on' : 'switches off'}`,
    '  ' + line('in match, uncapped', result.inMatch.uncapped),
    '  ' + line(`in match, cap ${frameCap}`, result.inMatch.capped),
    '  ' + line('menus, uncapped', result.outOfMatch.uncapped),
    `  pointer locks: ${rawInput ? `${locks.raw} raw, ${locks.notRaw} not raw` : 'raw mouse input was not asked for'}`,
    `  file: ${file}`
  ].join('\n');
  console.log(text);
  fs.appendFileSync(path.join(outDir, 'summary.txt'), text + '\n');
  app.quit();
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: process.env.KCC_AB_FULLSCREEN === '1',
    backgroundColor: '#000000',
    webPreferences: {
      preload: rawInput ? path.join(__dirname, 'preload.js') : undefined,
      sandbox: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(RECORDER, true).catch(() => {});
  });
  win.loadURL(url);
  win.on('close', (e) => { if (!done) { e.preventDefault(); finish('window closed'); } });

  globalShortcut.register('F9', () => setCap(!capped));
  globalShortcut.register('F10', () => finish('F10'));
  poll = setInterval(pull, 2000);
  if (minutes > 0) setTimeout(() => finish(`${minutes} minute limit`), minutes * 60 * 1000);
  console.log(`[kcc-ab] ${label}: loaded ${url}; F9 toggles a ${frameCap} cap, F10 quits and writes the results`);
});

app.on('window-all-closed', () => finish('window closed'));
app.on('will-quit', () => globalShortcut.unregisterAll());
