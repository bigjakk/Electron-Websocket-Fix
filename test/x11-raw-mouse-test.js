// X11 raw mouse checks for c51 (KccX11RawMouse), and for c12 and c15 on the
// X11 raw path that c51 adds. Linux/X11 only.
//
//   electron x11-raw-mouse-test.js --kcc-out=FILE [--kcc-vmouse-fifo=PATH]
//       [--enable-features=...] --ozone-platform=x11
//
// Needs the X11 session of linux-x11-env.sh: Xorg with libinput, openbox, and
// the uinput mouse "kcc-virtual-mouse" (its FIFO from --kcc-vmouse-fifo or
// $KCC_VMOUSE_FIFO). That mouse takes the real device path: libinput pointer
// acceleration applies to its core motion, XInput2 raw events carry its device
// counts. Keys go in through XTEST (xdotool).
//
// The page is raw-input.html. The script asks for pointer lock with
// { unadjustedMovement: true } (user gesture through executeJavaScript(...,
// true)); if that is refused (stock, or the switch off) it takes a plain lock,
// as the game falls back to, so both kinds of lock are measured. Each phase
// starts from reset page counters:
//   flat-fast       libinput flat profile, speed 0: (200,120) in 40 reports 2 ms apart
//   adaptive-fast   adaptive profile, speed 1: the same reports
//   adaptive-slow   adaptive profile, speed 1: (200,120) in 200 reports 8 ms apart
//   after-plain-request  requestPointerLock() again WITHOUT options while the
//                   lock is held (c12's case), then as adaptive-fast
//   esc             Escape must release the lock; then (100,0): no locked
//                   movement, and the X pointer moves (the mouse is usable)
//   drag            a lock taken in a mousedown handler while the button stays
//                   down (the case of the c51 desk-check bug), then (100,0) in
//                   20 reports 2 ms apart, then the button released: the
//                   buttons of every locked mousemove
//   held            the lock released, the left button pressed and held on
//                   the page, then the lock taken again (from script, not from
//                   an input event), then (100,0) in 20 reports: the buttons of
//                   every locked mousemove; then the button released and
//                   (100,0) again: the buttons after the release
//   none            the same with no button held
//   alt-tab         lock held, Alt+Tab (openbox) to another application's
//                   window (xmessage): the lock must be released, and (100,0)
//                   made while the other window has the focus must not reach
//                   the page as locked movement; then Alt+Tab back
// Every movement phase also records the XInput2 raw motion the X server
// reported for the master pointer (xinput test-xi2 --root): the counts a raw
// lock must match, and the MouseEvent.buttons values of its locked mousemoves
// (a histogram, from a listener this script adds: raw-input.html is shared
// with the Windows tests and stays as it is). The script only records;
// linux-run-checks.js judges.
//
// Exit code: 0 ran, 1 a phase could not run, 2 harness error.
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const FIFO = sw('kcc-vmouse-fifo', process.env.KCC_VMOUSE_FIFO || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { versions: process.versions.electron, enableFeatures: sw('enable-features', ''), display: process.env.DISPLAY || '', lock: {}, phases: {}, problems: [], events: [] };
const log = (s) => console.log(`[x11-raw-mouse-test] ${s}`);
let other = null;
function finish(code) {
  results.exitCode = code;
  if (other) { try { other.kill(); } catch { /* gone */ } }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  app.exit(code);
}
app.on('child-process-gone', (_e, d) => results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`));
app.on('render-process-gone', (_e, _w, d) => results.events.push(`render-process-gone ${d.reason} ${d.exitCode}`));
setTimeout(() => { log('WATCHDOG'); finish(2); }, 240000);

// Asynchronous on purpose: the browser UI thread must keep reading X events
// while the virtual mouse moves.
function run(cmd, args, timeout = 60000) {
  return new Promise((resolve) => {
    execFile(cmd, args.map(String), { timeout }, (err, stdout, stderr) =>
      resolve({ err: err ? String(err.message || err) : null, out: String(stdout).trim(), stderr: String(stderr).trim() }));
  });
}
const mouse = (...w) => run('python3', ['-I', path.join(__dirname, 'linux-vmouse.py'), 'send', FIFO, ...w]);
const accel = (profile, speed) => run(path.join(__dirname, 'linux-x11-env.sh'), ['accel', profile, speed]);
const xdotool = (...a) => run('xdotool', a);
async function pointer() {
  const m = /X=(-?\d+)\s+Y=(-?\d+)/.exec((await xdotool('getmouselocation', '--shell')).out);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
async function focusedWindow() { return Number((await xdotool('getwindowfocus')).out) || 0; }

let MASTER = 2;
// XInput2 raw motion of the master pointer between start and stop.
function captureRaw() {
  const child = spawn('stdbuf', ['-oL', 'xinput', 'test-xi2', '--root'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let text = '';
  child.stdout.on('data', (d) => { text += d; });
  return {
    async stop() {
      await sleep(300);
      child.kill();
      await sleep(100);
      const out = { events: 0, rawX: 0, rawY: 0, accelX: 0, accelY: 0, sources: {} };
      for (const block of text.split(/^EVENT /m)) {
        if (!/^type 17 \(RawMotion\)/.test(block)) continue;
        const dev = /device: (\d+) \((\d+)\)/.exec(block);
        if (!dev || Number(dev[1]) !== MASTER) continue;  // the master's copy only
        out.events++;
        out.sources[dev[2]] = (out.sources[dev[2]] || 0) + 1;
        const vx = /^\s+0: (-?[\d.]+) \((-?[\d.]+)\)/m.exec(block);
        const vy = /^\s+1: (-?[\d.]+) \((-?[\d.]+)\)/m.exec(block);
        if (vx) { out.accelX += Number(vx[1]); out.rawX += Number(vx[2]); }
        if (vy) { out.accelY += Number(vy[1]); out.rawY += Number(vy[2]); }
      }
      for (const k of ['rawX', 'rawY', 'accelX', 'accelY']) out[k] = Math.round(out[k] * 100) / 100;
      return out;
    },
  };
}

app.whenReady().then(async () => {
  try {
    if (!FIFO || !fs.existsSync(FIFO)) throw new Error(`no virtual mouse FIFO (${FIFO || 'unset'}); start linux-x11-env.sh first`);
    MASTER = Number((await run('xinput', ['list', '--id-only', 'Virtual core pointer'])).out) || 2;
    // Another application's window, mapped before ours so that ours ends up
    // with the focus; Alt+Tab goes to it.
    other = spawn('xmessage', ['-geometry', '+1350+60', 'kcc: another application'], { stdio: 'ignore' });
    await sleep(700);

    const win = new BrowserWindow({ x: 200, y: 150, width: 800, height: 600, show: true, webPreferences: { backgroundThrottling: false } });
    const wc = win.webContents;
    await win.loadFile(path.join(__dirname, 'raw-input.html'));
    win.focus();
    wc.focus();
    await sleep(800);
    const handle = win.getNativeWindowHandle();
    results.xid = handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
    results.focusAtStart = await focusedWindow();
    const isLocked = () => wc.executeJavaScript('kccLocked()');
    // MouseEvent.buttons of every locked mousemove, as a histogram.
    await wc.executeJavaScript(`(() => {
      const t = document.getElementById('t');
      window.kccBtnReset = () => { window.kccBtn = { n: 0, hist: {} }; };
      kccBtnReset();
      document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== t) return;
        kccBtn.n++;
        kccBtn.hist[e.buttons] = (kccBtn.hist[e.buttons] || 0) + 1;
      });
    })()`);
    const buttonsSeen = () => wc.executeJavaScript('JSON.parse(JSON.stringify(kccBtn))');
    // What the X server holds down on the virtual mouse (XI1 query of the slave
    // device; the master pointer cannot be queried that way).
    async function xButtonsDown() {
      const q = await run('xinput', ['query-state', 'kcc-virtual-mouse']);
      return q.err ? `error: ${q.err}` : [...q.out.matchAll(/button\[(\d+)\]=down/g)].map((m) => Number(m[1]));
    }

    async function settled() {
      // Until the counters have not changed for 300 ms (400 ms at least, 3 s at most).
      await sleep(400);
      let stats = await wc.executeJavaScript('kccStats()');
      for (let i = 0, still = 0; i < 26 && still < 3; i++) {
        await sleep(100);
        const next = await wc.executeJavaScript('kccStats()');
        still = JSON.stringify(next) === JSON.stringify(stats) ? still + 1 : 0;
        stats = next;
      }
      return stats;
    }

    async function movePhase(name, profile, speed, [dx, dy, n, ms], before) {
      const a = await accel(profile, speed);
      if (a.err) results.problems.push(`${name}: accel: ${a.err} ${a.stderr}`);
      await wc.executeJavaScript('kccReset(); kccBtnReset()');
      await sleep(200);
      const pre = before ? await before() : null;
      const cap = captureRaw();
      await sleep(300);
      const p0 = await pointer();
      const inj = await mouse('move', dx, dy, n, ms);
      const stats = await settled();
      const xi2 = await cap.stop();
      const buttons = await buttonsSeen();
      const p1 = await pointer();
      const stillLocked = await isLocked();
      results.phases[name] = { accel: `${profile} ${speed}`, sent: { dx, dy, reports: n, ms }, before: pre, inject: inj.err, stats, xi2, buttons, pointer: [p0, p1], stillLocked };
      log(`${name}: ${JSON.stringify(results.phases[name])}`);
      if (inj.err) results.problems.push(`${name}: injection: ${inj.err} ${inj.stderr}`);
      if (!stillLocked) results.problems.push(`${name}: lock lost`);
    }

    // ---- lock ----
    results.lock.unadjusted = await wc.executeJavaScript('kccLock({ unadjustedMovement: true })', true);
    results.lock.kind = 'raw';
    if (results.lock.unadjusted !== 'locked') {
      results.lock.kind = 'plain';
      await sleep(300);
      results.lock.plain = await wc.executeJavaScript('kccLock()', true);
      if (results.lock.plain !== 'locked') {
        results.problems.push(`no pointer lock at all: ${results.lock.unadjusted} / ${results.lock.plain}`);
        finish(1);
        return;
      }
    }
    log(`lock: ${JSON.stringify(results.lock)}`);
    const lockCall = results.lock.kind === 'raw' ? 'kccLock({ unadjustedMovement: true })' : 'kccLock()';
    await sleep(300);

    // ---- movement ----
    await movePhase('flat-fast', 'flat', 0, [200, 120, 40, 2]);
    await movePhase('adaptive-fast', 'adaptive', 1, [200, 120, 40, 2]);
    await movePhase('adaptive-slow', 'adaptive', 1, [200, 120, 200, 8]);
    await movePhase('after-plain-request', 'adaptive', 1, [200, 120, 40, 2], () => wc.executeJavaScript('kccLock()', true));

    // ---- esc ----
    {
      await wc.executeJavaScript('kccReset()');
      const lockedBefore = await isLocked();
      const k = await xdotool('key', 'Escape');
      await sleep(500);
      const lockedAfter = await isLocked();
      const p0 = await pointer();
      await mouse('move', 100, 0, 10, 2);
      const stats = await settled();
      const p1 = await pointer();
      results.phases.esc = { lockedBefore, key: k.err, lockedAfter, stats, pointer: [p0, p1] };
      log(`esc: ${JSON.stringify(results.phases.esc)}`);
    }

    // ---- drag: lock taken in a mousedown handler, button held ----
    {
      await accel('flat', 0);
      await sleep(1500);  // past the 1.25 s re-lock refusal after Esc (c11 removes it)
      const b = win.getContentBounds();
      await xdotool('mousemove', b.x + Math.round(b.width / 2), b.y + Math.round(b.height / 2));
      await sleep(300);
      await wc.executeJavaScript(`(() => {
        const t = document.getElementById('t');
        window.kccDrag = { armed: true, downs: 0, lock: null, moves: [] };
        t.addEventListener('mousedown', () => {
          kccDrag.downs++;
          if (!kccDrag.armed) return;
          kccDrag.armed = false;
          ${lockCall}.then((r) => { kccDrag.lock = r; });
        });
        document.addEventListener('mousemove', (e) => {
          if (document.pointerLockElement !== t) return;
          kccDrag.moves.push({ buttons: e.buttons, mx: e.movementX, my: e.movementY });
        });
      })()`);
      await mouse('down', 'left');
      let lock = null;
      for (let i = 0; i < 40 && !lock; i++) { await sleep(50); lock = await wc.executeJavaScript('kccDrag.lock'); }
      const lockedAtMove = await isLocked();
      await mouse('move', 100, 0, 20, 2);
      await sleep(400);
      const whileDown = await wc.executeJavaScript('kccDrag.moves.length');
      await mouse('up', 'left');
      await sleep(300);
      const d = await wc.executeJavaScript('JSON.parse(JSON.stringify(kccDrag))');
      const held = d.moves.slice(0, whileDown);
      results.phases.drag = {
        lock, lockedAtMove, downs: d.downs, movesWhileDown: held.length,
        buttonsZeroWhileDown: held.filter((m) => m.buttons === 0).length,
        firstButtons: held.slice(0, 5).map((m) => m.buttons), sumX: held.reduce((s, m) => s + m.mx, 0),
      };
      log(`drag: ${JSON.stringify(results.phases.drag)}`);
      if (lock !== 'locked') results.problems.push(`drag: lock from mousedown: ${lock}`);
    }

    // ---- held / none: a button held (or not) when the lock is taken ----
    async function buttonPhase(name, button) {
      if (await isLocked()) await wc.executeJavaScript('document.exitPointerLock()');
      await sleep(1500);  // a re-lock straight after an exit can be refused
      const unlockedFirst = !(await isLocked());
      await accel('flat', 0);
      const b = win.getContentBounds();
      await xdotool('mousemove', b.x + Math.round(b.width / 2), b.y + Math.round(b.height / 2));
      await sleep(300);
      if (button) { await mouse('down', button); await sleep(300); }
      const xDownAtLock = await xButtonsDown();
      const lock = await wc.executeJavaScript(lockCall, true);
      await sleep(300);
      await wc.executeJavaScript('kccReset(); kccBtnReset()');
      const cap = captureRaw();
      await sleep(300);
      const inj = await mouse('move', 100, 0, 20, 2);
      const stats = await settled();
      const xi2 = await cap.stop();
      const buttons = await buttonsSeen();
      let afterRelease = null;
      if (button) {
        await mouse('up', button);
        await sleep(300);
        await wc.executeJavaScript('kccBtnReset()');
        await mouse('move', 100, 0, 20, 2);
        await settled();
        afterRelease = { xDown: await xButtonsDown(), ...(await buttonsSeen()) };
      }
      const stillLocked = await isLocked();
      results.phases[name] = { button, unlockedFirst, xDownAtLock, lock, sent: { dx: 100, dy: 0, reports: 20, ms: 2 }, inject: inj.err, stats, xi2, buttons, afterRelease, stillLocked };
      log(`${name}: ${JSON.stringify(results.phases[name])}`);
      if (lock !== 'locked') results.problems.push(`${name}: lock: ${lock}`);
      if (inj.err) results.problems.push(`${name}: injection: ${inj.err} ${inj.stderr}`);
    }
    await buttonPhase('held', 'left');
    await buttonPhase('none', null);

    // ---- alt-tab ----
    {
      if (!(await isLocked())) {
        await sleep(300);
        await wc.executeJavaScript(lockCall, true);
        await sleep(300);
      }
      await wc.executeJavaScript('kccReset()');
      const lockedBefore = await isLocked();
      const focusBefore = await focusedWindow();
      await xdotool('key', 'alt+Tab');
      await sleep(800);
      const focusAfter = await focusedWindow();
      const lockedAfter = await isLocked();
      const p0 = await pointer();
      const cap = captureRaw();
      await sleep(300);
      await mouse('move', 100, 0, 10, 2);
      const stats = await settled();
      const xi2 = await cap.stop();
      const p1 = await pointer();
      await xdotool('key', 'alt+Tab');
      await sleep(800);
      const focusBack = await focusedWindow();
      results.phases['alt-tab'] = { lockedBefore, focusBefore, focusAfter, lockedAfter, stats, xi2, pointer: [p0, p1], focusBack };
      log(`alt-tab: ${JSON.stringify(results.phases['alt-tab'])}`);
    }

    if (await isLocked()) { await xdotool('key', 'Escape'); await sleep(300); }
    finish(results.problems.length || results.events.length ? 1 : 0);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
