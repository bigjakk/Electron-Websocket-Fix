// c10 (keyup-after-handled-keydown back-port) synthetic check.
//
//   electron.exe keyup-test.js [--kcc-out=FILE]
//
// A before-input-event listener preventDefault()s every event of one key (P).
// Then: keydown A, keydown P, keyup P, keyup A. The page must receive the keyup
// of A. Stock 156 swallows every KeyUp after a browser-handled keydown until
// the next keydown, so a build without c10 shows "keydown KeyA" only.
// The sequence is sent twice: through webContents.sendInputEvent and through
// CDP Input.dispatchKeyEvent (both reach
// RenderWidgetHostImpl::ForwardKeyboardEventWithCommands).
//
// Exit code: 0 pass, 1 fail, 2 harness error.
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { versions: process.versions.electron, checks: [], events: [] };
const log = (s) => console.log(`[keyup-test] ${s}`);
function check(name, pass, detail) { results.checks.push({ name, pass: !!pass, detail }); log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); }
function finish(code) { results.exitCode = code; if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); app.exit(code); }
app.on('child-process-gone', (_e, d) => results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`));
app.on('render-process-gone', (_e, _w, d) => results.events.push(`render-process-gone ${d.reason} ${d.exitCode}`));
setTimeout(() => { log('WATCHDOG'); finish(2); }, 120000);

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 600, height: 400, show: true, webPreferences: { backgroundThrottling: false } });
    win.setAlwaysOnTop(true);
    const wc = win.webContents;
    const seen = [];
    wc.on('before-input-event', (event, input) => {
      seen.push(`${input.type} ${input.code}`);
      if (input.code === 'KeyP') event.preventDefault();
    });
    await win.loadFile(path.join(__dirname, 'input-log.html'));
    win.focus();
    wc.focus();
    await sleep(800);

    // 1. webContents.sendInputEvent
    await wc.executeJavaScript('kccReset()');
    seen.length = 0;
    for (const [type, keyCode] of [['keyDown', 'A'], ['keyDown', 'P'], ['keyUp', 'P'], ['keyUp', 'A']]) {
      wc.sendInputEvent({ type, keyCode });
      await sleep(60);
    }
    await sleep(400);
    const page1 = await wc.executeJavaScript('kccLog.slice()');
    results.sendInputEvent = { page: page1, beforeInputEvent: seen.slice() };
    log(`sendInputEvent: page saw [${page1.join(', ')}]; before-input-event saw [${seen.join(', ')}]`);
    check('sendInputEvent: page receives keyup A after a prevented key', page1.includes('keyup KeyA'), `page: ${page1.join(', ')}`);
    check('sendInputEvent: prevented key never reaches the page', !page1.some((e) => e.endsWith('KeyP')), `page: ${page1.join(', ')}`);

    // 2. CDP Input.dispatchKeyEvent
    await wc.executeJavaScript('kccReset()');
    seen.length = 0;
    wc.debugger.attach('1.3');
    const key = (type, code, keyCode, k) => wc.debugger.sendCommand('Input.dispatchKeyEvent',
      { type, code, key: k, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await key('rawKeyDown', 'KeyA', 65, 'a'); await sleep(60);
    await key('rawKeyDown', 'KeyP', 80, 'p'); await sleep(60);
    await key('keyUp', 'KeyP', 80, 'p'); await sleep(60);
    await key('keyUp', 'KeyA', 65, 'a');
    await sleep(400);
    wc.debugger.detach();
    const page2 = await wc.executeJavaScript('kccLog.slice()');
    results.cdp = { page: page2, beforeInputEvent: seen.slice() };
    log(`CDP: page saw [${page2.join(', ')}]; before-input-event saw [${seen.join(', ')}]`);
    check('CDP: page receives keyup A after a prevented key', page2.includes('keyup KeyA'), `page: ${page2.join(', ')}`);
    check('CDP: prevented key never reaches the page', !page2.some((e) => e.endsWith('KeyP')), `page: ${page2.join(', ')}`);

    // 3. The plain sequence still works (no prevented key involved).
    await wc.executeJavaScript('kccReset()');
    for (const [type, keyCode] of [['keyDown', 'A'], ['keyDown', 'S'], ['keyUp', 'S'], ['keyUp', 'A']]) {
      wc.sendInputEvent({ type, keyCode });
      await sleep(60);
    }
    await sleep(400);
    const page3 = await wc.executeJavaScript('kccLog.slice()');
    check('control: unprevented keys all arrive', ['keydown KeyA', 'keydown KeyS', 'keyup KeyS', 'keyup KeyA'].every((e) => page3.includes(e)), `page: ${page3.join(', ')}`);

    finish(results.checks.every((c) => c.pass) && results.events.length === 0 ? 0 : 1);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
