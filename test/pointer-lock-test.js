// c11 (KccNoPointerLockEscCooldown) synthetic check.
//
//   electron.exe pointer-lock-test.js [--kcc-out=FILE] [--enable-features=...]
//
// Locks the pointer with a user gesture (executeJavaScript(..., true)), sends
// Esc through webContents.sendInputEvent (it reaches WebContents::
// PreHandleKeyboardEvent -> ExclusiveAccessManager::HandleUserKeyEvent, which
// stamps the escape time), then asks for the lock again at once.
//   stock / switch off: refused with kUserEscapeCooldown (SecurityError
//                       "...immediately after the user has exited the lock.")
//   switch on:          locked
// Controls, the same in both modes: a request 1.5 s after an Esc locks, and a
// request without a user gesture after an Esc is refused (NotAllowedError, "A
// user gesture is required"); that one waits 5.5 s so the transient activation
// of the earlier gesture calls has expired.
// Real pointer lock: the window must be on the interactive desktop and focused.
//
// Exit code: 0 pass, 1 fail, 2 harness error.
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const ON = sw('enable-features', '').split(',').some((f) => f.split(':')[0] === 'KccNoPointerLockEscCooldown');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { versions: process.versions.electron, switchOn: ON, steps: [], checks: [], events: [] };
const log = (s) => console.log(`[pointer-lock-test] ${s}`);
function check(name, pass, detail) { results.checks.push({ name, pass: !!pass, detail }); log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); }
function finish(code) { results.exitCode = code; if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); app.exit(code); }
app.on('child-process-gone', (_e, d) => results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`));
app.on('render-process-gone', (_e, _w, d) => results.events.push(`render-process-gone ${d.reason} ${d.exitCode}`));
setTimeout(() => { log('WATCHDOG'); finish(2); }, 90000);

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 600, height: 400, show: true, webPreferences: { backgroundThrottling: false } });
    win.setAlwaysOnTop(true);
    const wc = win.webContents;
    await win.loadFile(path.join(__dirname, 'pointer-lock.html'));
    win.focus();
    wc.focus();
    await sleep(800);

    const t0 = Date.now();
    const step = (what, result) => { const s = { atMs: Date.now() - t0, what, result }; results.steps.push(s); log(`${s.atMs} ms  ${what}: ${result}`); return result; };
    const lock = async (gesture, what) => step(what, await wc.executeJavaScript('kccLock()', gesture));
    const isLocked = () => wc.executeJavaScript('kccLocked()');
    const waitUnlocked = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (!(await isLocked())) return true; await sleep(20); } return false; };
    let lastEsc = 0;
    const esc = async () => {
      lastEsc = Date.now();
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      await sleep(30);
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      const ok = await waitUnlocked(1000);
      step('Esc', ok ? `unlocked after ${Date.now() - lastEsc} ms` : 'still locked after 1000 ms');
      return ok;
    };

    // 1. A lock with a user gesture works at all on this desktop.
    const r1 = await lock(true, 'request with gesture');
    if (r1 !== 'locked') {
      check('pointer lock is available here', false, `first request: ${r1} (needs a focused window on the interactive desktop)`);
      finish(1);
      return;
    }
    check('lock with a user gesture', true, r1);

    // 2. Esc releases it.
    check('Esc releases the lock', await esc(), '');

    // 3. Re-lock at once, inside the 1.25 s cooldown.
    const r3 = await lock(true, `request with gesture ${Date.now() - lastEsc} ms after Esc`);
    results.relockAfterEsc = { msAfterEsc: results.steps.at(-1).atMs - (lastEsc - t0), result: r3 };
    if (ON) check('switch on: re-lock inside the cooldown succeeds', r3 === 'locked', r3);
    else check('switch off: re-lock inside the cooldown is refused (kUserEscapeCooldown)', /^rejected SecurityError: .*immediately after the user has exited the lock/.test(r3), r3);
    if (await isLocked()) await esc();

    // 4. Control: after the cooldown a re-lock works in both modes.
    await sleep(Math.max(0, 1500 - (Date.now() - lastEsc)));
    const r4 = await lock(true, `request with gesture ${Date.now() - lastEsc} ms after Esc`);
    check('control: re-lock 1.5 s after Esc succeeds', r4 === 'locked', r4);

    // 5. Control: without a user gesture an Esc'd lock is not re-taken.
    if (await isLocked()) await esc();
    await sleep(5500);
    const r5 = await lock(false, `request WITHOUT gesture ${Date.now() - lastEsc} ms after Esc`);
    check('control: a request without a user gesture is refused', /^rejected NotAllowedError: A user gesture is required/.test(r5), r5);
    if (await isLocked()) await esc();

    results.pageEvents = await wc.executeJavaScript('kccEvents.slice()');
    finish(results.checks.every((c) => c.pass) && results.events.length === 0 ? 0 : 1);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
