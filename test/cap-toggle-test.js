// Alternates setFrameCap(0) with a cap above reach on the busy frame-cap page,
// in short windows, so that every capped window has uncapped neighbours
// measured moments before and after it, in the same state of the machine.
//
// Written after the Stage 3 heavy-suite comparisons for c60
// (KccFrameCapPreciseRelease). There the uncapped window always comes first,
// and the comparison is between runs. On this VM, whose speed comes in a fast
// and a slow state, the runs that started fast stayed fast once a cap was set
// with the switch off, but fell to slow with it on.
//
//   electron cap-toggle-test.js --kcc-busy=5 [--kcc-caps=1000,240] [--kcc-cycles=8]
//            [--kcc-window-ms=4000] [--kcc-mode=webgl|2d] --kcc-out=<json>
//            [--enable-features=...]
//
// Sequence: an uncapped window, then per cycle a capped window and an uncapped
// one (the cap cycles through --kcc-caps). Each pair's ratio is the capped rate
// over the mean of its two uncapped neighbours.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const BUSY = parseFloat(sw('kcc-busy', '5'));
const CAPS = sw('kcc-caps', '1000,240').split(',').map(Number);
const CYCLES = parseInt(sw('kcc-cycles', '8'), 10);
const WINDOW_MS = parseInt(sw('kcc-window-ms', '4000'), 10);
const MODE = sw('kcc-mode', 'webgl');
const res = { busy: BUSY, caps: CAPS, cycles: CYCLES, windowMs: WINDOW_MS, mode: MODE, windows: [], pairs: [], events: [] };
const log = (s) => console.log(`[cap-toggle] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
setTimeout(() => { log('WATCHDOG: no result in time'); finish(2); }, (2 * CYCLES + 1) * (WINDOW_MS + 2000) + 30000);

async function measure(wc, cap) {
  const m = await wc.executeJavaScript(`kcc.measure(${WINDOW_MS})`);
  const w = { cap, fps: m.fps, meanMs: m.meanMs, sdMs: m.sdMs, p50Ms: m.p50Ms };
  res.windows.push(w);
  log(`cap ${String(cap).padStart(4)}: ${m.fps.toFixed(2)} fps (interval mean ${m.meanMs.toFixed(3)} sd ${m.sdMs.toFixed(3)} ms)`);
  return w;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640, height: 480, useContentSize: true, show: true,
    webPreferences: { backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true);
  await win.loadFile(path.join(__dirname, 'frame-cap.html'), { query: { busy: String(BUSY), label: 'main', mode: MODE } });
  const wc = win.webContents;
  await sleep(1500);
  if (MODE === 'webgl' && await wc.executeJavaScript('gl.isContextLost()')) {
    res.events.push('WEBGL CONTEXT LOST at load');
    log('WEBGL CONTEXT LOST at load: nothing measured');
    return finish(1);
  }
  const set = async (cap) => { win.setFrameCap(cap); await sleep(300); };
  await set(0);
  let before = await measure(wc, 0);
  for (let c = 0; c < CYCLES; c++) {
    const cap = CAPS[c % CAPS.length];
    await set(cap);
    const capped = await measure(wc, cap);
    await set(0);
    const after = await measure(wc, 0);
    const ratio = capped.fps / ((before.fps + after.fps) / 2);
    res.pairs.push({ cap, capped: capped.fps, before: before.fps, after: after.fps, ratio });
    log(`  cycle ${c + 1}: cap ${cap} ${capped.fps.toFixed(1)} vs uncapped neighbours ` +
        `${before.fps.toFixed(1)} / ${after.fps.toFixed(1)}: ${((ratio - 1) * 100).toFixed(1)} %`);
    before = after;
  }
  finish(res.events.length ? 1 : 0);
});
