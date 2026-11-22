// One launch of the frame-cap page in WebGL mode: did its WebGL2 context
// survive startup? Written after a Stage 3 frame-cap runtime run (every
// switch on) whose page lost its context at load, the only time in 34 runs of
// the WebGL page (results/stage3-release/all-runtime-webgl-try1.log).
//
//   electron webgl-startup-test.js --kcc-out=<file.json> [--enable-features=...]
//
// Same switches and window as frame-cap-test.js. Waits 1.5 s after the load,
// then reads gl.isContextLost() in the page and counts its own rAF callbacks
// for 1 s (a lost context leaves the page without damage, and rAF then runs
// near 58/s instead of several hundred). Exit 0: context alive, no
// CONTEXT_LOST console message, no child process gone; 1 otherwise.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
const OUT = app.commandLine.getSwitchValue('kcc-out');
const res = { events: [], consoleLost: [], page: null };
const log = (s) => console.log(`[webgl-startup] ${s}`);

app.on('child-process-gone', (_e, d) => {
  const s = `child-process-gone type=${d.type} reason=${d.reason} exitCode=${d.exitCode}`;
  res.events.push(s);
  log(s);
});
app.on('render-process-gone', (_e, _wc, d) => {
  const s = `render-process-gone reason=${d.reason} exitCode=${d.exitCode}`;
  res.events.push(s);
  log(s);
});

function finish(code) {
  res.exit = code;
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  app.exit(code);
}
setTimeout(() => { log('WATCHDOG: no result after 30 s'); finish(2); }, 30000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640, height: 480, useContentSize: true, show: true,
    webPreferences: { backgroundThrottling: false },
  });
  win.webContents.on('console-message', (e, _level, message) => {
    const m = (e && e.message) || message || '';
    if (/CONTEXT_LOST/.test(m)) {
      res.consoleLost.push(m);
      log(`console: ${m}`);
    }
  });
  const t0 = Date.now();
  await win.loadFile(path.join(__dirname, 'frame-cap.html'), { query: { busy: '0', label: 'main', mode: 'webgl' } });
  res.loadMs = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 1500));
  res.page = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    let n = 0;
    const t0 = performance.now();
    const step = () => {
      n++;
      if (performance.now() - t0 < 1000) requestAnimationFrame(step);
      else resolve({ hasGl: !!gl, lost: gl ? gl.isContextLost() : null, rafPerSec: n });
    };
    requestAnimationFrame(step);
  })`);
  res.webglStatus = app.getGPUFeatureStatus().webgl;
  log(`load ${res.loadMs} ms, gl ${res.page.hasGl}, lost ${res.page.lost}, rAF ${res.page.rafPerSec}/s, ` +
      `console lost ${res.consoleLost.length}, events ${res.events.length}`);
  const ok = res.page.hasGl && !res.page.lost && res.consoleLost.length === 0 && res.events.length === 0;
  finish(ok ? 0 : 1);
});
