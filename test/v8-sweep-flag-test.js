// v01 (cppgc sweep slice) synthetic check.
//
//   electron.exe v8-sweep-flag-test.js --kcc-out=FILE --kcc-trace=FILE
//       [--kcc-expect-ms=N] ["--js-flags=--cppheap-max-incremental-sweep-duration-ms=N"]
//
// Records a trace (category "cppgc") while gc-churn.html makes V8 run natural
// major GCs, and reads the max_duration_ms argument of every
// CppGC.SweepInTask / CppGC.SweepInLowPriorityTask slice. Every slice must carry
// the expected value (default 5, the stock constant; N when the flag is given).
// Whether V8 accepted the flag at all is also visible in the log: V8 reports an
// unknown --js-flags entry on stderr.
// Exit code: 0 pass, 1 fail, 2 harness error.
'use strict';
const { app, BrowserWindow, contentTracing } = require('electron');
const path = require('path');
const fs = require('fs');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const TRACE = sw('kcc-trace', path.join(app.getPath('temp'), 'kcc-sweep-trace.json'));
const EXPECT = parseFloat(sw('kcc-expect-ms', '5'));
const results = { jsFlags: sw('js-flags', ''), expectMs: EXPECT, checks: [], events: [] };
const log = (s) => console.log(`[v8-sweep] ${s}`);
function check(name, pass, detail) { results.checks.push({ name, pass: !!pass, detail }); log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); }
function finish(code) { results.exitCode = code; if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); app.exit(code); }
app.on('child-process-gone', (_e, d) => results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`));
app.on('render-process-gone', (_e, _w, d) => results.events.push(`render-process-gone ${d.reason} ${d.exitCode}`));
setTimeout(() => { log('WATCHDOG'); finish(2); }, 180000);

app.whenReady().then(async () => {
  try {
    await contentTracing.startRecording({ included_categories: ['cppgc'], excluded_categories: ['*'] });
    const win = new BrowserWindow({ width: 400, height: 300, show: true, webPreferences: { backgroundThrottling: false } });
    await win.loadFile(path.join(__dirname, 'gc-churn.html'), { query: { ms: '10000' } });
    const page = await win.webContents.executeJavaScript('kccDone');
    results.page = page;
    const file = await contentTracing.stopRecording(TRACE);
    const trace = JSON.parse(fs.readFileSync(file, 'utf8'));
    const events = Array.isArray(trace) ? trace : trace.traceEvents;
    const byName = {};
    for (const e of events) {
      if (e.name !== 'CppGC.SweepInTask' && e.name !== 'CppGC.SweepInLowPriorityTask') continue;
      if (e.ph !== 'X' && e.ph !== 'B') continue;
      const v = e.args ? e.args.max_duration_ms : undefined;
      const entry = byName[e.name] || (byName[e.name] = { count: 0, values: {}, durationsMs: [] });
      entry.count++;
      entry.values[String(v)] = (entry.values[String(v)] || 0) + 1;
      if (typeof e.dur === 'number') entry.durationsMs.push(e.dur / 1000);
    }
    for (const k of Object.keys(byName)) {
      const d = byName[k].durationsMs.sort((a, b) => a - b);
      byName[k].maxSliceMs = d.length ? d[d.length - 1] : null;
      byName[k].p50SliceMs = d.length ? d[Math.floor(d.length / 2)] : null;
      delete byName[k].durationsMs;
    }
    results.sweepSlices = byName;
    log(`page churn rounds ${page.rounds}; slices ${JSON.stringify(byName)}`);
    const all = Object.values(byName);
    const total = all.reduce((a, e) => a + e.count, 0);
    check('incremental sweep slices were traced', total > 0, `${total} slices`);
    const bad = all.flatMap((e) => Object.keys(e.values).filter((v) => parseFloat(v) !== EXPECT));
    check(`every slice carries max_duration_ms = ${EXPECT}`, total > 0 && bad.length === 0,
      `values seen: ${all.map((e) => JSON.stringify(e.values)).join(' ')}`);
    finish(results.checks.every((c) => c.pass) && results.events.length === 0 ? 0 : 1);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
