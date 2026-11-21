// Raw-input checks for c12, c13, c14 and c15, driven by SendInput.
//
//   electron.exe raw-input-test.js --kcc-out=FILE [--enable-features=...]
//
// Takes pointer lock with { unadjustedMovement: true } (user gesture through
// executeJavaScript(..., true)) and injects relative mouse packets with
// send-input.ps1, which only sends while this app's window is in the
// foreground. Each phase starts from reset page counters:
//   raw-move    40 packets (+5, +3), 2 ms apart: plain raw motion. Packets
//               arrive faster than main frames, so the page sees coalesced
//               pointermoves.
//   raw-wheel   40 packets (+5, 0), each carrying a +120 wheel tick, 10 ms
//               apart: c13's case (button flags exactly RI_MOUSE_WHEEL).
//   after-plain-request  requestPointerLock() again WITHOUT options while the
//               raw lock is held (RequestMouseLockChange(false): c12's case),
//               then 40 packets (+5, +3), 2 ms apart.
// The script only records; run-checks.ps1 compares switch-off and switch-on
// runs. What each switch should change:
//   c13 KccRawInputKeepWheelMotion  raw-wheel movement 0 -> 200
//   c14 KccRawInputFastPath         nothing visible (sums, wheel count same)
//   c15 KccLeanLockedMouseMove      raw-move: coalesced lists of 1, no
//                                   predicted events; movement sums same
//   c12 KccPinRawPointerLock        after-plain-request: the lock stays raw,
//                                   seen only through c15 (run both on)
//
// Exit code: 0 ran, 1 a phase could not run (no lock, injection aborted),
// 2 harness error.
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { versions: process.versions.electron, enableFeatures: sw('enable-features', ''), phases: {}, problems: [], events: [] };
const log = (s) => console.log(`[raw-input-test] ${s}`);
function finish(code) { results.exitCode = code; if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); app.exit(code); }
app.on('child-process-gone', (_e, d) => results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`));
app.on('render-process-gone', (_e, _w, d) => results.events.push(`render-process-gone ${d.reason} ${d.exitCode}`));
setTimeout(() => { log('WATCHDOG'); finish(2); }, 120000);

// Asynchronous on purpose: the browser UI thread (this process) must keep
// pumping WM_INPUT while the packets are injected.
function inject(plan) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'send-input.ps1'), '-TargetPid', String(process.pid), '-Plan', plan],
      { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => resolve({ err: err ? String(err.message || err) : null, out: String(stdout).trim(), stderr: String(stderr).trim() }));
  });
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 600, height: 400, show: true, webPreferences: { backgroundThrottling: false } });
    win.setAlwaysOnTop(true);
    const wc = win.webContents;
    await win.loadFile(path.join(__dirname, 'raw-input.html'));
    win.focus();
    wc.focus();
    await sleep(800);
    const isLocked = () => wc.executeJavaScript('kccLocked()');

    async function phase(name, plan, before) {
      await wc.executeJavaScript('kccReset()');
      await sleep(200);
      const pre = before ? await before() : null;
      const inj = await inject(plan);
      // Wait until the counters have not changed for 300 ms (400 ms at least,
      // 3 s at most). A fixed 400 ms once came out one wheel notch short
      // (-3900 instead of -4000) in one of this VM's slow stretches. A notch
      // is also lost now and then by configurations that do not touch the
      // wheel path at all (stock included), so a lone -3900 is not a patch effect.
      await sleep(400);
      let stats = await wc.executeJavaScript('kccStats()');
      for (let i = 0, still = 0; i < 26 && still < 3; i++) {
        await sleep(100);
        const next = await wc.executeJavaScript('kccStats()');
        still = JSON.stringify(next) === JSON.stringify(stats) ? still + 1 : 0;
        stats = next;
      }
      const stillLocked = await isLocked();
      results.phases[name] = { plan, before: pre, inject: inj, stats, stillLocked };
      log(`${name}: ${JSON.stringify(results.phases[name])}`);
      if (inj.err || !/^OK /.test(inj.out)) results.problems.push(`${name}: injection ${inj.err || inj.out} ${inj.stderr}`);
      if (!stillLocked) results.problems.push(`${name}: lock lost`);
    }

    const r = await wc.executeJavaScript('kccLock({ unadjustedMovement: true })', true);
    results.lock = r;
    log(`raw lock: ${r}`);
    if (r !== 'locked') {
      results.problems.push(`raw pointer lock not available: ${r}`);
      finish(1);
      return;
    }
    await sleep(300);
    await phase('raw-move', '40,5,3,0,2000');
    await phase('raw-wheel', '40,5,0,120,10000');
    await phase('after-plain-request', '40,5,3,0,2000', () => wc.executeJavaScript('kccLock()', true));
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(30);
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await sleep(300);
    finish(results.problems.length || results.events.length ? 1 : 0);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
