// c21 (WebGL fast API calls) synthetic check: one run of webgl-fast-api.html.
//
//   electron.exe webgl-fast-api-test.js --kcc-out=FILE
//       "--js-flags=--allow-natives-syntax"                            (fast calls on)
//       "--js-flags=--allow-natives-syntax --no-turbo-fast-api-calls"  (reference)
//
// The driver (run-checks.ps1) runs both and compares errHash, errCounts and
// pixHash, which must be identical; the hot function must be TurboFan-optimised
// in both runs. Exit code: 0 the page ran, 1 it reported an error or a process
// died, 2 harness error.
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const results = { jsFlags: sw('js-flags', ''), enableFeatures: sw('enable-features', ''), events: [] };
const log = (s) => console.log(`[webgl-fast-api] ${s}`);
function finish(code) { results.exitCode = code; if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); app.exit(code); }
app.on('child-process-gone', (_e, d) => { results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`); });
app.on('render-process-gone', (_e, _w, d) => { results.events.push(`render-process-gone ${d.reason} ${d.exitCode}`); log(`render-process-gone ${d.reason}`); finish(1); });
setTimeout(() => { log('WATCHDOG'); finish(2); }, 300000);

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 320, height: 320, show: true, webPreferences: { backgroundThrottling: false } });
    await win.loadFile(path.join(__dirname, 'webgl-fast-api.html'));
    const r = await win.webContents.executeJavaScript('kccResult');
    results.gpuFeatureStatus = app.getGPUFeatureStatus();
    results.page = r;
    log(JSON.stringify(r));
    finish(r.error || results.events.length ? 1 : 0);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
