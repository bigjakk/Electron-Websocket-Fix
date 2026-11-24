// Raw mouse input, as the client turns it on by default on Windows ("Raw
// Input" in its settings): every pointer lock the game's canvas requests gets
// unadjustedMovement added. Same wrap as KCC's preload and as
// ../../pgo/krunker-train/preload.js; contextIsolation is off, so this runs
// in the page's own world before its scripts.
//
// Without it the lock is the ordinary one: Chromium derives movement from the
// position of the hidden cursor and puts it back in the middle of the window
// whenever it comes near an edge, which can show as a sudden view flick, and
// none of the series' raw-input patches (c12 to c15) run.
const { ipcRenderer } = require('electron');

const origLock = HTMLCanvasElement.prototype.requestPointerLock;
HTMLCanvasElement.prototype.requestPointerLock = function (opts) {
  const promise = origLock.call(this, { ...opts, unadjustedMovement: true });
  if (promise && typeof promise.catch === 'function') {
    promise.then(() => ipcRenderer.send('kcc-raw-lock', true), () => {});
    return promise.catch(() => {
      ipcRenderer.send('kcc-raw-lock', false);
      return origLock.call(this, opts);
    });
  }
  return promise;
};
