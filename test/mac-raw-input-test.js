// macOS raw-input check for c12 (KccPinRawPointerLock) and c15
// (KccLeanLockedMouseMove), driven by KccMouseInject.app (mac-mouse-inject.m,
// built by mac-build-mouse-inject.sh; it needs the Accessibility permission).
// The macOS counterpart of raw-input-test.js; mac-run-raw-input.js runs the
// variants and compares them. The events are injected, not from a physical
// mouse: the check shows which movement fields the lock reads and what a
// locked pointermove carries, not how a real device feels.
//
//   <Electron.app>/Contents/MacOS/Electron mac-raw-input-test.js --kcc-out=FILE
//       --kcc-injector=<dir>/KccMouseInject.app [--kcc-tap=hid|session|pid]
//       [--kcc-marked=1] [--enable-features=...]
//
// Every measured mouse move carries two movements: (+11, +7) as the
// accelerated delta, which Chromium uses unless the pointer lock is raw, and
// (+5, +3) as the unaccelerated movement, which it uses in a raw lock
// (web_input_event_builders_mac.mm). So the movement sums show the mode of the
// lock, with no mouse-acceleration curve involved.
//
// What the phases are built around (all seen with every switch off):
//   - Not every injected move reaches the page. A move sent alone by a freshly
//     started injector almost never does, the first move of a sequence now and
//     then does not, and after a new lock more of the first moves can go
//     missing: taking the lock can warp the cursor into the window, and Chromium
//     then drops the first locked move on purpose (render_widget_host_view_cocoa.mm,
//     _suppressNextLockedMouseMoveForRecenter). So each phase's injection starts
//     with 3 lead-in moves of (+1, +1) in both movements, 150 ms apart, then the
//     measured moves. The page records every locked mousemove, and the lead-in
//     moves are told apart by their movement.
//   - macOS merges injected moves that come faster than the display refresh
//     into one event, with the summed accelerated delta but only one move's
//     unaccelerated movement. So the phases that compare sums space the moves
//     20 ms apart, and a run counts only when all 40 measured moves of them
//     reached the page (mac-run-raw-input.js).
// Phases, each 40 measured moves:
//   adjusted-lock        20 ms apart. requestPointerLock() without options,
//                        from unlocked: the adjusted path, (440, 280) in every
//                        variant. Then exitPointerLock().
//   raw-move             20 ms apart. requestPointerLock({ unadjustedMovement:
//                        true }): the raw path, (200, 120) in every variant.
//   raw-burst            2 ms apart in the raw lock: macOS merges them, the
//                        page gets about one event per frame. For c15's shape.
//   raw-burst-busy       the same while a requestAnimationFrame loop keeps the
//                        main thread busy for 25 ms per frame, so that Blink
//                        coalesces several events per pointermove.
//   after-plain-request  20 ms apart, after requestPointerLock() again WITHOUT
//                        options while the raw lock is held
//                        (RequestMouseLockChange(false), c12's case): stock
//                        (440, 280), with KccPinRawPointerLock (200, 120).
// What each switch should change:
//   c12  after-plain-request: the lock stays raw, (200, 120).
//   c15  raw-burst and raw-burst-busy: coalesced lists of 1 and no predicted
//        events (stock: predicted events, and lists of more than 1 when busy).
//
// The window must keep the focus for the whole run: when another app takes
// it, the lock is gone and the injector stops (it only sends while this app is
// the frontmost one), and the run ends as interrupted.
// Exit code: 0 ran, 1 a phase could not run (no lock, injection failed),
// 2 harness error, 3 interrupted (another app took the focus).
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const INJECTOR = sw('kcc-injector', '');
const TAP = sw('kcc-tap', 'hid');
const LEAD = '3,1,1,1,1,150000';
// --kcc-marked=1 (diagnosis): the first and the last measured move of each
// 20 ms phase carry other values, (13, 9 | 7, 5) and (12, 8 | 6, 4), so the sums
// tell which one went missing: (443, 283) adjusted and (203, 123) raw in full.
const MARKED = sw('kcc-marked', '') === '1';
const SLOW = MARKED ? '1,13,9,7,5,20000;38,11,7,5,3,20000;1,12,8,6,4,20000' : '40,11,7,5,3,20000';
const BURST = '40,11,7,5,3,2000';
const BUSY_MS = 25;
const BUSY_START = `(() => { window.kccBusyOn = true; const f = () => { if (!window.kccBusyOn) return;
  const t = performance.now(); while (performance.now() - t < ${BUSY_MS}) {} requestAnimationFrame(f); };
  requestAnimationFrame(f); return true; })()`;
const BUSY_STOP = '(() => { window.kccBusyOn = false; return true; })()';
// Every locked mousemove, as [ms since the phase's injection started,
// movementX, movementY].
const TRACE_RESET = `(() => { window.kccTraceArr = []; if (!window.kccTraceOn) { window.kccTraceOn = true;
  document.addEventListener('mousemove', (e) => { if (document.pointerLockElement) window.kccTraceArr.push(
    [Math.round(performance.now()), e.movementX, e.movementY]); }, true); } return true; })()`;
const TRACE_READ = 'window.kccTraceArr.slice()';
const isLead = ([, x, y]) => x === 1 && y === 1;
// The measured moves of a phase, from the trace: count, sums, the largest gap.
function measured(trace) {
  const m = trace.filter((e) => !isLead(e));
  let maxGapMs = 0;
  for (let i = 1; i < m.length; i++) maxGapMs = Math.max(maxGapMs, m[i][0] - m[i - 1][0]);
  return {
    n: m.length, mx: m.reduce((a, e) => a + e[1], 0), my: m.reduce((a, e) => a + e[2], 0),
    leadSeen: trace.length - m.length, maxGapMs,
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {
  versions: process.versions.electron, enableFeatures: sw('enable-features', ''), tap: TAP,
  lead: LEAD, slow: SLOW, burst: BURST, busyMs: BUSY_MS, phases: {}, problems: [], events: [], interrupted: null,
};
const log = (s) => console.log(`[mac-raw-input-test] ${s}`);
function finish(code) {
  results.exitCode = code;
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  app.exit(code);
}
app.on('child-process-gone', (_e, d) => results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`));
app.on('render-process-gone', (_e, _w, d) => results.events.push(`render-process-gone ${d.reason} ${d.exitCode}`));
setTimeout(() => { log('WATCHDOG'); finish(2); }, 150000);

// Asynchronous on purpose: this process (the browser UI thread) must keep
// handling the injected events while the injector runs. `open` starts the
// injector through LaunchServices (-g: not brought to the front, -W: wait for
// it to exit, -n: a new instance).
let seq = 0;
function inject(plan) {
  const file = path.join(os.tmpdir(), `kcc-mouse-inject-${process.pid}-${++seq}.txt`);
  return new Promise((resolve) => {
    execFile('open', ['-g', '-W', '-n', INJECTOR, '--args', '--out', file, '--pid', String(process.pid),
      '--plan', plan, '--tap', TAP], { timeout: 60000 }, (err) => {
      let out = '';
      try { out = fs.readFileSync(file, 'utf8').trim(); fs.unlinkSync(file); } catch { /* no output */ }
      resolve({ err: err ? String(err.message || err) : null, out });
    });
  });
}

app.whenReady().then(async () => {
  try {
    if (!INJECTOR) { log('HARNESS ERROR: --kcc-injector is required'); finish(2); return; }
    const win = new BrowserWindow({ width: 600, height: 400, show: true, webPreferences: { backgroundThrottling: false } });
    win.setAlwaysOnTop(true);
    const wc = win.webContents;
    await win.loadFile(path.join(__dirname, 'raw-input.html'));
    app.focus({ steal: true });
    win.focus();
    wc.focus();
    for (let i = 0; i < 50 && !win.isFocused(); i++) await sleep(100);
    await sleep(500);
    results.focused = win.isFocused();
    results.pageHasFocus = await wc.executeJavaScript('document.hasFocus()');
    log(`focused: window ${results.focused}, page ${results.pageHasFocus}`);
    if (!results.focused) { results.interrupted = 'the window did not get the focus'; finish(3); return; }
    win.on('blur', () => { if (!results.interrupted) results.interrupted = 'the window lost the focus'; });
    const isLocked = () => wc.executeJavaScript('kccLocked()');
    const stop = () => { log(`interrupted: ${results.interrupted}`); finish(3); };

    // One phase: [before], reset the page counters and the trace, inject the
    // lead-in and the measured moves in one injector run, then wait until the
    // counters have not changed for 300 ms (400 ms at least, 3 s at most), as
    // raw-input-test.js does. stats: the page's counters (lead-in included);
    // measured: the measured moves only, from the trace.
    async function phase(name, plan, before) {
      const pre = before ? await before() : null;
      if (before) await sleep(200);
      await wc.executeJavaScript('kccReset()');
      await wc.executeJavaScript(TRACE_RESET);
      await sleep(100);
      const t0 = await wc.executeJavaScript('Math.round(performance.now())');
      const inj = await inject(`${LEAD};${plan}`);
      if (/^ABORT /.test(inj.out) && !results.interrupted) results.interrupted = inj.out;
      await sleep(400);
      let stats = await wc.executeJavaScript('kccStats()');
      for (let i = 0, still = 0; i < 26 && still < 3; i++) {
        await sleep(100);
        const next = await wc.executeJavaScript('kccStats()');
        still = JSON.stringify(next) === JSON.stringify(stats) ? still + 1 : 0;
        stats = next;
      }
      const stillLocked = await isLocked();
      const trace = (await wc.executeJavaScript(TRACE_READ)).map(([t, x, y]) => [t - t0, x, y]);
      results.phases[name] = { plan, before: pre, inject: inj, stats, measured: measured(trace), trace, stillLocked };
      log(`${name}: ${JSON.stringify({ ...results.phases[name], trace: undefined })}`);
      if (results.interrupted) return false;
      if (inj.err || !/^OK /.test(inj.out)) results.problems.push(`${name}: injection ${inj.err || ''} ${inj.out}`.trim());
      if (!stillLocked) results.problems.push(`${name}: lock lost`);
      return true;
    }

    async function lock(opts, label) {
      const r = await wc.executeJavaScript(`kccLock(${opts ? JSON.stringify(opts) : ''})`, true);
      results[label] = r;
      log(`${label}: ${r}`);
      if (r === 'locked') return true;
      if (!results.interrupted) results.problems.push(`${label}: pointer lock not available: ${r}`);
      return false;
    }

    if (!await lock(null, 'adjustedLock')) { if (results.interrupted) stop(); else finish(1); return; }
    await sleep(300);
    if (!await phase('adjusted-lock', SLOW)) { stop(); return; }
    await wc.executeJavaScript('document.exitPointerLock()');
    for (let i = 0; i < 30 && await isLocked(); i++) await sleep(100);
    await sleep(1200);
    if (results.interrupted) { stop(); return; }

    if (!await lock({ unadjustedMovement: true }, 'rawLock')) { if (results.interrupted) stop(); else finish(1); return; }
    await sleep(300);
    if (!await phase('raw-move', SLOW)) { stop(); return; }
    if (!await phase('raw-burst', BURST)) { stop(); return; }
    await wc.executeJavaScript(BUSY_START);
    await sleep(300);
    const busyOk = await phase('raw-burst-busy', BURST);
    await wc.executeJavaScript(BUSY_STOP);
    await sleep(300);
    if (!busyOk) { stop(); return; }
    if (!await phase('after-plain-request', SLOW, () => wc.executeJavaScript('kccLock()', true))) { stop(); return; }
    await wc.executeJavaScript('document.exitPointerLock()');
    await sleep(300);
    finish(results.problems.length || results.events.length ? 1 : 0);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
