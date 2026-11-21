// Generic runner for the synthetic check pages: loads one page, awaits its
// window.kccResult promise and writes the result as JSON.
//
//   electron.exe page-check.js --kcc-page=<file.html> --kcc-out=FILE
//       [--kcc-query=a=1&b=2] [--kcc-raw-out=FILE] [--kcc-timeout-s=N]
//       [--kcc-trace=FILE --kcc-trace-categories=a,b]  (records a trace meanwhile)
//
// With --kcc-trace the JSON also gets traceCounts: how many slices / instants
// of each event name the trace holds (read with perfetto-trace.js, since
// Electron 45 writes Perfetto protobuf traces).
//
// --kcc-raw-out: if the result has rawBase64, it is decoded into this file and
// removed from the JSON. Exit code: 0 the page ran, 1 it reported an error or a
// process died, 2 harness error.
'use strict';
const { app, BrowserWindow, contentTracing } = require('electron');
const path = require('path');
const fs = require('fs');
const { readTraceEvents } = require('./perfetto-trace');

app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const PAGE = sw('kcc-page', '');
const OUT = sw('kcc-out', '');
const RAW = sw('kcc-raw-out', '');
const QUERY = sw('kcc-query', '');
const TRACE = sw('kcc-trace', '');
const CATS = sw('kcc-trace-categories', '');
const TIMEOUT_S = parseInt(sw('kcc-timeout-s', '240'), 10);
const results = { page: PAGE, query: QUERY, enableFeatures: sw('enable-features', ''), jsFlags: sw('js-flags', ''), events: [] };
const log = (s) => console.log(`[page-check:${PAGE}] ${s}`);
function finish(code) { results.exitCode = code; if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); app.exit(code); }
app.on('child-process-gone', (_e, d) => { results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`); log(results.events.at(-1)); });
app.on('render-process-gone', (_e, _w, d) => { results.events.push(`render-process-gone ${d.reason} ${d.exitCode}`); log(results.events.at(-1)); finish(1); });
setTimeout(() => { log('WATCHDOG'); finish(2); }, TIMEOUT_S * 1000);

app.whenReady().then(async () => {
  try {
    if (TRACE) await contentTracing.startRecording({ included_categories: CATS.split(',').filter(Boolean), excluded_categories: ['*'] });
    const win = new BrowserWindow({ width: 640, height: 480, show: true, webPreferences: { backgroundThrottling: false } });
    win.setAlwaysOnTop(true);
    const query = Object.fromEntries(new URLSearchParams(QUERY));
    await win.loadFile(path.join(__dirname, PAGE), { query });
    const r = await win.webContents.executeJavaScript('kccResult');
    if (TRACE) {
      results.traceFile = await contentTracing.stopRecording(TRACE);
      const counts = {};
      for (const e of readTraceEvents(results.traceFile)) counts[e.name] = (counts[e.name] || 0) + 1;
      results.traceCounts = counts;
    }
    results.gpuFeatureStatus = app.getGPUFeatureStatus();
    if (r && r.rawBase64 !== undefined) {
      if (RAW) fs.writeFileSync(RAW, Buffer.from(r.rawBase64, 'base64'));
      r.rawBytes = Buffer.from(r.rawBase64, 'base64').length;
      delete r.rawBase64;
    }
    results.result = r;
    log(JSON.stringify(r).slice(0, 2000));
    finish(r && r.error ? 1 : (results.events.length ? 1 : 0));
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
