// c50 (KccX11AllowUnredirect): the _NET_WM_BYPASS_COMPOSITOR hint on the
// windows this build creates. Linux/X11 only.
//
//   electron x11-window-props-test.js --kcc-out=FILE [--enable-features=...] --ozone-platform=x11
//
// Opens an ordinary window, a transparent (ARGB) window and a non-focusable
// window and reads, with xprop and xwininfo, the hint and the override-redirect
// state of each. Stock, and with the switch off: 2 on every window. With the
// switch: 1 on an ordinary opaque top-level window that is not
// override-redirect, 2 on the others. The script only records;
// linux-run-checks.js judges. Without a compositing window manager only the
// property can be checked, not whether a compositor then unredirects.
//
// Exit code: 0 ran, 2 harness error.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const { execFileSync } = require('child_process');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { versions: process.versions.electron, enableFeatures: sw('enable-features', ''), windows: [], events: [] };
const log = (s) => console.log(`[x11-window-props-test] ${s}`);
function finish(code) { results.exitCode = code; if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); app.exit(code); }
app.on('child-process-gone', (_e, d) => results.events.push(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`));
setTimeout(() => { log('WATCHDOG'); finish(2); }, 60000);

const xidOf = (win) => { const h = win.getNativeWindowHandle(); return h.length >= 8 ? Number(h.readBigUInt64LE(0)) : h.readUInt32LE(0); };
const tool = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 10000 }); } catch (e) { return `ERROR ${e.message}`; } };

app.whenReady().then(async () => {
  try {
    const kinds = [
      ['ordinary', {}],
      ['transparent', { transparent: true, frame: false }],
      ['non-focusable', { focusable: false }],
    ];
    let x = 100;
    for (const [kind, opts] of kinds) {
      const win = new BrowserWindow({ x, y: 100, width: 320, height: 200, show: true, ...opts });
      x += 360;
      await win.loadURL('data:text/html,<body style="background:%23234;color:white">kcc</body>');
      await sleep(500);
      const xid = xidOf(win);
      const p = tool('xprop', ['-id', String(xid), '_NET_WM_BYPASS_COMPOSITOR']);
      const m = /=\s*(\d+)/.exec(p);
      const wi = tool('xwininfo', ['-id', String(xid)]);
      const or = /Override Redirect State:\s*(\w+)/.exec(wi);
      const depth = /Depth:\s*(\d+)/.exec(wi);
      const w = { kind, xid, bypassCompositor: m ? Number(m[1]) : null, xprop: p.trim(), overrideRedirect: or ? or[1] === 'yes' : null, depth: depth ? Number(depth[1]) : null };
      results.windows.push(w);
      log(JSON.stringify(w));
    }
    finish(0);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    finish(2);
  }
});
