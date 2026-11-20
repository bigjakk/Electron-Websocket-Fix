// e10 (skip-unobserved-input-emits) synthetic check.
//
//   electron.exe input-emit-test.js [--kcc-out=FILE] [--enable-features=KccSkipUnobservedInputEmits]
//
// Meant to be run twice, with the feature off and on; every check must pass in
// both. Mouse moves are sent with webContents.sendInputEvent, which goes through
// RenderWidgetHostImpl::ForwardMouseEventWithLatencyInfo (delegate
// PreHandleMouseEvent -> 'before-mouse-event', input event observers ->
// 'input-event').
//   1. no listener: the page receives the moves (more than half: the renderer
//      coalesces moves that land in one frame);
//   2. an 'input-event' listener receives every move while it is registered, and
//      nothing after it is removed; the page keeps receiving moves throughout;
//   3. with two listeners, removing one leaves the other receiving;
//   4. a once() listener receives exactly one event;
//   5. a 'before-mouse-event' listener that calls preventDefault() blocks the
//      page's mouse events, and the page receives them again once it is removed;
//   6. a 'before-mouse-event' listener that does not prevent sees every move.
// Exit code: 0 pass, 1 fail, 2 harness error.
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const N = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { enableFeatures: sw('enable-features', ''), checks: [], events: [] };
const log = (s) => console.log(`[input-emit] ${s}`);
function check(name, pass, detail) { results.checks.push({ name, pass: !!pass, detail }); log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); }
function finish(code) { results.exitCode = code; if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); app.exit(code); }
app.on('child-process-gone', (_e, d) => results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`));
app.on('render-process-gone', (_e, _w, d) => results.events.push(`render-process-gone ${d.reason} ${d.exitCode}`));
setTimeout(() => { log('WATCHDOG'); finish(2); }, 120000);

let pos = 0;
async function sendMoves(wc, n = N) {
  for (let i = 0; i < n; i++) {
    pos = (pos + 7) % 300;
    wc.sendInputEvent({ type: 'mouseMove', x: 50 + pos, y: 60 + (pos % 50) });
    await sleep(40);  // apart enough that most moves are not coalesced into one frame
  }
  await sleep(300);
}
const pageMoves = async (wc) => wc.executeJavaScript('kccMouse.mousemove');
const resetPage = async (wc) => wc.executeJavaScript('kccReset()');
const isMove = (e) => e && e.type === 'mouseMove';

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 600, height: 400, show: true, webPreferences: { backgroundThrottling: false } });
    win.setAlwaysOnTop(true);
    const wc = win.webContents;
    await win.loadFile(path.join(__dirname, 'input-log.html'));
    win.focus();
    await sleep(800);
    await sendMoves(wc, 5);  // warm-up

    // 1. No listener at all.
    await resetPage(wc);
    await sendMoves(wc);
    let p = await pageMoves(wc);
    check('no listener: page receives the moves', p > N / 2, `page mousemove ${p} of ${N}`);

    // 2. One input-event listener, then removed.
    let got = 0;
    const onInput = (_e, input) => { if (isMove(input)) got++; };
    wc.on('input-event', onInput);
    await resetPage(wc);
    await sendMoves(wc);
    p = await pageMoves(wc);
    check('input-event listener receives every move while registered', got >= N, `listener ${got} of ${N}, page ${p}`);
    wc.removeListener('input-event', onInput);
    const gotAtRemoval = got;
    await resetPage(wc);
    await sendMoves(wc);
    p = await pageMoves(wc);
    check('removed input-event listener receives nothing more', got === gotAtRemoval, `listener ${got - gotAtRemoval} after removal`);
    check('page still receives moves after the listener is removed', p > N / 2, `page ${p} of ${N}`);

    // 2b. Added again after removal (the flag must come back on).
    let got2 = 0;
    const onInput2 = (_e, input) => { if (isMove(input)) got2++; };
    wc.on('input-event', onInput2);
    await sendMoves(wc);
    check('input-event listener added again receives every move', got2 >= N, `listener ${got2} of ${N}`);

    // 3. Two listeners; removing one leaves the other.
    let got3 = 0;
    const onInput3 = (_e, input) => { if (isMove(input)) got3++; };
    wc.on('input-event', onInput3);
    wc.removeListener('input-event', onInput2);
    await sendMoves(wc);
    check('with two listeners, removing one leaves the other receiving', got3 >= N, `remaining listener ${got3} of ${N}`);
    wc.removeListener('input-event', onInput3);

    // 4. once()
    let gotOnce = 0;
    wc.once('input-event', () => { gotOnce++; });
    await sendMoves(wc);
    check('once() input-event listener runs exactly once', gotOnce === 1, `ran ${gotOnce} times`);

    // 5. before-mouse-event preventDefault blocks the page.
    let prevented = 0;
    const blocker = (event, mouse) => { if (mouse && mouse.type === 'mouseMove') prevented++; event.preventDefault(); };
    wc.on('before-mouse-event', blocker);
    await resetPage(wc);
    await sendMoves(wc);
    p = await pageMoves(wc);
    check('before-mouse-event preventDefault() blocks page mouse events', p === 0 && prevented >= N, `page ${p}, listener saw ${prevented}`);
    wc.removeListener('before-mouse-event', blocker);
    await resetPage(wc);
    await sendMoves(wc);
    p = await pageMoves(wc);
    check('page receives mouse events again after the blocker is removed', p > N / 2, `page ${p} of ${N}`);

    // 6. Non-preventing before-mouse-event listener.
    let observed = 0;
    const observer = (_event, mouse) => { if (mouse && mouse.type === 'mouseMove') observed++; };
    wc.on('before-mouse-event', observer);
    await resetPage(wc);
    await sendMoves(wc);
    p = await pageMoves(wc);
    check('non-preventing before-mouse-event listener sees every move', observed >= N && p > N / 2, `listener ${observed}, page ${p}`);
    wc.removeListener('before-mouse-event', observer);

    finish(results.checks.every((c) => c.pass) && results.events.length === 0 ? 0 : 1);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
