// Manual check of c12 (KccPinRawPointerLock) and c15 (KccLeanLockedMouseMove)
// on macOS with a physical mouse: nothing injects input. Electron main script;
// opens mac-raw-mouse-manual.html, a local pointer-lock page that shows what to
// do and what to read off.
//
//   <Electron.app>/Contents/MacOS/Electron mac-raw-mouse-manual.js
//   <Electron.app>/Contents/MacOS/Electron mac-raw-mouse-manual.js \
//       --enable-features=KccPinRawPointerLock,KccLeanLockedMouseMove
//
// Run it from test/ (or give the script's full path), once with the switches
// off and once with them on, and compare the two readings the page shows:
//   c12  after the page re-requests the lock without unadjustedMovement (key R),
//        is the movement still raw? Stock macOS turns OS acceleration back on,
//        so a fast sweep then sums to much more than a slow sweep over the same
//        distance; with KccPinRawPointerLock both stay about equal.
//   c15  while the raw lock is held, do pointermove events carry predicted
//        events and multi-entry coalesced lists (stock) or none and one
//        (KccLeanLockedMouseMove)?
// The window title and the page show which switches this launch has.
// --kcc-exit-ms=N closes it after N ms (to check that the page loads).
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');

const features = app.commandLine.hasSwitch('enable-features') ? app.commandLine.getSwitchValue('enable-features') : '';
const exitMs = Number(app.commandLine.getSwitchValue('kcc-exit-ms') || 0);
if (exitMs > 0) setTimeout(() => app.quit(), exitMs);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1100, height: 760, show: true,
    title: `raw mouse check - ${features || 'no switch'}`,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, 'mac-raw-mouse-manual.html'), { query: { features: features || 'none' } });
  win.focus();
  win.webContents.focus();
});
app.on('window-all-closed', () => app.quit());
