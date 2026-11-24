// Krunker training harness for PGO profile collection.
//
// Run this with an *instrumented* Electron build (chrome_pgo_phase = 1) and
// LLVM_PROFILE_FILE set, play real matches, then quit cleanly. See ../README.md.
//
// Environment:
//   KCC_PGO_FEATURES   comma-separated --enable-features list. Pass the SAME
//                      list the shipped client will use, so the patched code
//                      paths are the ones that get trained.
//   KCC_PGO_JS_FLAGS   value for --js-flags (same rule).
//   KCC_PGO_MINUTES    quit automatically after N minutes (0 = never).
//   KCC_PGO_FRAME_CAP  if set (e.g. 240), the second half of a timed session
//                      runs with win.setFrameCap(N) so the capped path is
//                      trained too. F9 toggles it by hand.
//   KCC_PGO_URL        page to load (default https://krunker.io/).
//   KCC_PGO_RAW_INPUT  0 = do not ask for raw mouse movement. Default: ask
//                      for it on Windows, as the client does (preload.js).
//
// Keys: F9 toggle frame cap, F10 quit cleanly. Closing the window also quits
// cleanly. Do NOT kill the process: a killed process writes no profile.
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');

const features = (process.env.KCC_PGO_FEATURES || '').trim();
const jsFlags = (process.env.KCC_PGO_JS_FLAGS || '').trim();
const minutes = Number(process.env.KCC_PGO_MINUTES || 0);
const frameCap = Number(process.env.KCC_PGO_FRAME_CAP || 0);
const url = process.env.KCC_PGO_URL || 'https://krunker.io/';
const rawInput = process.platform === 'win32' && process.env.KCC_PGO_RAW_INPUT !== '0';

// The switches the client ships with at its default settings (FPS unlocked,
// high-performance GPU, "remove useless features" on, "extra performance
// tweaks" off). Keep in step with applyPlatformFlags() in KCC's platform.ts.
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
  .replace(/\skrunker-pgo-train\/\S+/i, '');

let win = null;
let capped = false;

function setCap(on) {
  capped = on;
  if (win && typeof win.setFrameCap === 'function') {
    win.setFrameCap(on ? frameCap || 240 : 0);
    console.log(`[pgo-train] frame cap ${on ? (frameCap || 240) : 'off'}`);
  } else {
    console.log('[pgo-train] win.setFrameCap is not available in this build');
  }
}

// Pointer locks the page was granted, as preload.js reports them.
const locks = { raw: 0, notRaw: 0 };
ipcMain.on('kcc-raw-lock', (_event, raw) => {
  locks[raw ? 'raw' : 'notRaw']++;
  if (locks.raw + locks.notRaw === 1) {
    console.log(`[pgo-train] first pointer lock: ${raw ? 'raw mouse input' : 'NOT raw (unadjustedMovement was refused)'}`);
  }
});

function quit(reason) {
  console.log(`[pgo-train] pointer locks: ${rawInput ? `${locks.raw} raw, ${locks.notRaw} not raw` : 'raw mouse input was not asked for'}`);
  console.log(`[pgo-train] quitting cleanly (${reason}); wait for every process to exit`);
  app.quit();
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: process.env.KCC_PGO_FULLSCREEN === '1',
    backgroundColor: '#000000',
    webPreferences: {
      preload: rawInput ? path.join(__dirname, 'preload.js') : undefined,
      sandbox: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadURL(url);
  win.on('closed', () => { win = null; });

  globalShortcut.register('F9', () => setCap(!capped));
  globalShortcut.register('F10', () => quit('F10'));

  if (minutes > 0) {
    const ms = minutes * 60 * 1000;
    if (frameCap > 0) setTimeout(() => setCap(true), ms / 2);
    setTimeout(() => quit(`${minutes} minute limit`), ms);
  }
  console.log(`[pgo-train] loaded ${url}`);
  console.log(`[pgo-train] LLVM_PROFILE_FILE=${process.env.LLVM_PROFILE_FILE || '(NOT SET - nothing will be collected)'}`);
});

app.on('window-all-closed', () => quit('window closed'));
app.on('will-quit', () => globalShortcut.unregisterAll());
