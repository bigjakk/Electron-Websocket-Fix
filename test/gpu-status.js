// Records what the GPU process is running on, for RESULTS.md: Electron's
// app.getGPUFeatureStatus(), app.getGPUInfo('basic'), the WebGL renderer
// string a page sees, and the versions baked into the binary.
//
//   electron.exe gpu-status.js --kcc-out=FILE
//
// Exit code: 0 written, 2 harness error.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
setTimeout(() => { console.log('[gpu-status] WATCHDOG'); app.exit(2); }, 60000);

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 320, height: 240, show: true });
    await win.loadURL('data:text/html,<canvas id=c></canvas>');
    const webgl = await win.webContents.executeJavaScript(`(() => {
      const out = {};
      for (const kind of ['webgl2', 'webgl']) {
        const gl = document.createElement('canvas').getContext(kind);
        if (!gl) { out[kind] = null; continue; }
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        out[kind] = {
          vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
          renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
        };
      }
      return out;
    })()`);
    const res = {
      versions: { electron: process.versions.electron, chrome: process.versions.chrome, v8: process.versions.v8, node: process.versions.node },
      gpuFeatureStatus: app.getGPUFeatureStatus(),
      gpuInfoBasic: await app.getGPUInfo('basic'),
      webgl,
    };
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
    console.log(`[gpu-status] ${JSON.stringify({ versions: res.versions, gpu_compositing: res.gpuFeatureStatus.gpu_compositing, webgl2: webgl.webgl2 })}`);
    app.exit(0);
  } catch (e) {
    console.log(`[gpu-status] HARNESS ERROR: ${e.stack || e}`);
    app.exit(2);
  }
});
