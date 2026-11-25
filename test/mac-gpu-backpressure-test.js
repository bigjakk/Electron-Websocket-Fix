// c32 (KccMacFineGpuBackpressure) check for macOS: does the GPU main thread wait
// for the previous frame, and how long? Electron main script.
//
// Loads mac-gpu-heavy.html (a GPU-bound WebGL2 page), or with
// --kcc-page=frame-cap the gates' light page frame-cap.html, uncapped (the same
// --disable-frame-rate-limit --disable-gpu-vsync as the gates), lets it warm
// up, then measures the page's frame rate over a window, optionally while
// recording a trace. From the trace it reports count and duration statistics
// of the two waits c32 changes and of the work around them:
//   GLES2DecoderPassthroughImpl::DescheduleUntilFinished  (command buffer
//       deschedule until the previous frame's fence completes)
//   CALayerTreeCoordinator::ApplyBackpressure            (presenter fence wait)
//   CommandBufferStub::PerformWork / PollWork            (the stub's poll timer)
// c32's description: if a stock trace shows neither wait, the patch has nothing
// to act on and should be dropped.
//
//   electron mac-gpu-backpressure-test.js --kcc-out=FILE [--kcc-trace=FILE]
//       [--kcc-page=heavy|frame-cap]   heavy (default): mac-gpu-heavy.html in a
//                                      1280x720 window; frame-cap: the gates'
//                                      page frame-cap.html (busy 0) in their
//                                      640x480 always-on-top window, a light page
//       [--kcc-mode=webgl|2d]          frame-cap page only (default webgl)
//       [--kcc-iters=N]                heavy page: fragment-shader loop iterations (default 256)
//       [--kcc-warmup-ms=MS]           default 3000
//       [--kcc-window-ms=MS]           default 5000
//       [--kcc-trace-categories=a,b]   default gpu,cc,viz
//       [--enable-features=KccMacFineGpuBackpressure[:poll_us/N]]
//
// Exit code: 0 measured, 1 no frames or the WebGL context was lost, 2 harness error.
'use strict';
const { app, BrowserWindow, contentTracing } = require('electron');
const fs = require('fs');
const path = require('path');
const { readTraceEvents } = require('./perfetto-trace');

app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

const sw = (n, d) => (app.commandLine.hasSwitch(n) ? app.commandLine.getSwitchValue(n) : d);
const OUT = sw('kcc-out', '');
const TRACE = sw('kcc-trace', '');
const PAGE = sw('kcc-page', 'heavy');
const MODE = sw('kcc-mode', 'webgl');
const ITERS = Number(sw('kcc-iters', '256'));
const WARMUP_MS = Number(sw('kcc-warmup-ms', '3000'));
const WINDOW_MS = Number(sw('kcc-window-ms', '5000'));
const CATS = sw('kcc-trace-categories', 'gpu,cc,viz').split(',').filter(Boolean);
// Slices whose durations are summarised (every name is counted).
const WATCH = /DescheduleUntilFinished|RescheduleAfterFinished|ApplyBackpressure|CommandBufferStub::(PerformWork|PollWork)|CommitPresentedFrameToCA|ImageTransportSurfaceOverlayMac/;

const log = (s) => console.log(`[mac-bp] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); app.exit(2); }, WARMUP_MS + WINDOW_MS + 90000);
app.on('child-process-gone', (_e, d) => log(`child-process-gone type=${d.type} reason=${d.reason} exitCode=${d.exitCode}`));
app.on('render-process-gone', (_e, _wc, d) => log(`render-process-gone reason=${d.reason} exitCode=${d.exitCode}`));

function stats(durs) {
  const s = durs.slice().sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const sum = s.reduce((a, b) => a + b, 0);
  return { count: s.length, totalMs: sum / 1000, meanUs: sum / s.length, p50Us: at(0.5), p90Us: at(0.9), p99Us: at(0.99), maxUs: s[s.length - 1] };
}

function summarize(events) {
  const counts = {};
  const durs = {};
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const e of events) {
    counts[e.name] = (counts[e.name] || 0) + 1;
    if (typeof e.ts === 'number') { t0 = Math.min(t0, e.ts); t1 = Math.max(t1, e.ts + (e.dur || 0)); }
    if (WATCH.test(e.name) && e.ph === 'X' && typeof e.dur === 'number') (durs[e.name] = durs[e.name] || []).push(e.dur);
  }
  const slices = {};
  for (const [name, d] of Object.entries(durs)) slices[name] = stats(d);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40);
  return { spanMs: Number.isFinite(t0) ? (t1 - t0) / 1000 : 0, slices, watchedCounts: Object.fromEntries(Object.entries(counts).filter(([n]) => WATCH.test(n))), topCounts: Object.fromEntries(top) };
}

// frame-cap.html's kcc.measure() result in the shape of mac-gpu-heavy.html's
// kcc.stats().
const fromMeasure = (m) => ({
  frames: m.frames,
  fps: m.fps,
  frameMs: { p50: m.p50Ms, p90: null, p99: m.p99Ms, max: m.maxMs },
  low1PctFps: m.p99Ms ? 1000 / m.p99Ms : null,
});

app.whenReady().then(async () => {
  try {
    const light = PAGE === 'frame-cap';
    const win = light
      ? new BrowserWindow({ width: 640, height: 480, useContentSize: true, show: true, webPreferences: { backgroundThrottling: false } })
      : new BrowserWindow({ width: 1280, height: 720, show: true, webPreferences: { backgroundThrottling: false } });
    if (light) {
      win.setAlwaysOnTop(true);
      await win.loadFile(path.join(__dirname, 'frame-cap.html'), { query: { busy: '0', label: 'main', mode: MODE } });
    } else {
      await win.loadFile(path.join(__dirname, 'mac-gpu-heavy.html'), { query: { iters: String(ITERS) } });
    }
    const wc = win.webContents;
    await sleep(WARMUP_MS);
    if (TRACE) await contentTracing.startRecording({ included_categories: CATS, excluded_categories: ['*'] });
    let page;
    if (light) {
      page = fromMeasure(await wc.executeJavaScript(`kcc.measure(${WINDOW_MS})`));
    } else {
      await wc.executeJavaScript('kcc.reset()');
      await sleep(WINDOW_MS);
      page = await wc.executeJavaScript('kcc.stats()');
    }
    let trace = null;
    if (TRACE) {
      const file = await contentTracing.stopRecording(TRACE);
      trace = summarize(readTraceEvents(file));
    }
    // frame-cap.html: the GPU string when WebGL2 is up, else its own '2d'.
    const lightRenderer = '(() => { try { const e = typeof gl !== "undefined" && gl && gl.getExtension("WEBGL_debug_renderer_info");' +
      ' return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : kcc.renderer; } catch (x) { return kcc.renderer; } })()';
    const res = {
      pageName: PAGE,
      mode: light ? MODE : 'webgl',
      iters: light ? null : ITERS,
      windowMs: WINDOW_MS,
      traced: !!TRACE,
      categories: TRACE ? CATS : [],
      renderer: await wc.executeJavaScript(light ? lightRenderer : 'kcc.renderer'),
      canvas: await wc.executeJavaScript(light ? '[document.getElementById("c").width, document.getElementById("c").height]' : 'kcc.size'),
      lost: await wc.executeJavaScript(light ? '(typeof gl !== "undefined" && gl) ? gl.isContextLost() : false' : 'kcc.lost()'),
      page,
      gpuFeatureStatus: app.getGPUFeatureStatus(),
      trace,
    };
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
    const w = (n) => {
      const key = trace && Object.keys(trace.slices).find((x) => x.includes(n));
      const s = key && trace.slices[key];
      return s ? `${n} ${s.count}x p50 ${Math.round(s.p50Us)} us p90 ${Math.round(s.p90Us)} us total ${s.totalMs.toFixed(1)} ms` : `${n} none`;
    };
    log(`${light ? `frame-cap page (${MODE})` : `heavy page, iters ${ITERS}`} canvas ${res.canvas.join('x')} renderer ${res.renderer}: ` +
      `${page.frames} frames, ${page.fps ? page.fps.toFixed(1) : 'n/a'} fps, ` +
      `1% low ${page.low1PctFps ? page.low1PctFps.toFixed(1) : 'n/a'} fps, lost ${res.lost}` +
      (trace ? `; ${w('DescheduleUntilFinished')}; ${w('ApplyBackpressure')}; ${w('PerformWork')}` : ''));
    app.exit(page.frames > 1 && !res.lost ? 0 : 1);
  } catch (e) {
    log(`HARNESS ERROR: ${e.stack || e}`);
    app.exit(2);
  }
});
