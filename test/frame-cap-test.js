// Frame-cap release gate for the KCC Electron 45 patch series.
//
// Electron main script. Loads frame-cap.html, which counts requestAnimationFrame
// callbacks, and measures the frame rate in the page's own clock.
//
//   electron.exe frame-cap-test.js --kcc-suite=<launch|runtime|heavy|cpu>
//       [--kcc-cap=N]          the CustomFrameCap:fps/N the process was launched
//                              with (launch suite), or the cap to use (cpu suite)
//       [--kcc-busy=MS]        per-frame JS work in the page (heavy suite)
//       [--kcc-window-ms=MS]   measurement window, default 10000
//       [--kcc-mode=webgl|2d]  how the page draws (default webgl)
//       [--kcc-out=FILE]       write the results as JSON
//       [--enable-features=...] passed through to Chromium as usual
//
// Suites:
//   launch   process launched with CustomFrameCap:fps/N: N over 10 s, again after
//            hide/show and after a resize, setFrameCap(0) uncaps, setFrameCap(N)
//            re-caps.
//   runtime  process launched uncapped: setFrameCap(60/144/240) over 10 s each,
//            hide/show and resize at 144, a change of N takes effect at once (2 s
//            windows right after the call), setFrameCap(0) uncaps, and a second
//            animating WebContentsView in the window.
//   heavy    page spins --kcc-busy ms per frame: uncapped reach R, then caps of
//            1000 and 240 (above R) and 144; the caller compares runs flag off vs
//            on (the rate must not drop).
//   cpu      at --kcc-cap (default 144): CPU time of the GPU process and of each
//            of its threads (VizCompositorThread, CrGpuMain) over one window.
//   latency  at --kcc-cap (default 144): trace (cc, viz, benchmark) of how long
//            a submitted renderer frame waits before the display draws it (c61).
//
// Exit code: 0 all checks passed, 1 a check failed, 2 harness error,
// 3 no frames at all (desktop session locked or disconnected: rAF never runs).
'use strict';

const { app, BrowserWindow, WebContentsView, contentTracing } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

const sw = (name, def) => (app.commandLine.hasSwitch(name) ? app.commandLine.getSwitchValue(name) : def);
const SUITE = sw('kcc-suite', 'runtime');
const CAP = parseInt(sw('kcc-cap', '0'), 10) || 0;
const BUSY = parseFloat(sw('kcc-busy', '0')) || 0;
const WINDOW_MS = parseInt(sw('kcc-window-ms', '10000'), 10);
const OUT = sw('kcc-out', '');
const MODE = sw('kcc-mode', 'webgl');  // page drawing: webgl | 2d
const TOL = 0.01;        // 10 s windows: within 1 %
const TOL_SHORT = 0.03;  // 2 s windows right after a change

const results = {
  suite: SUITE, cap: CAP, busy: BUSY, mode: MODE, windowMs: WINDOW_MS,
  enableFeatures: sw('enable-features', ''),
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, v8: process.versions.v8 },
  measurements: [], checks: [], events: [], started: new Date().toISOString(),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(`[frame-cap:${SUITE}] ${s}`);

function finish(code) {
  results.finished = new Date().toISOString();
  results.exitCode = code;
  results.failed = results.checks.filter((c) => !c.pass).map((c) => c.name);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  log(`${results.checks.length - results.failed.length}/${results.checks.length} checks passed, exit ${code}`);
  app.exit(code);
}

setTimeout(() => { results.events.push('WATCHDOG: suite did not finish in 15 min'); log('WATCHDOG'); finish(2); }, 15 * 60 * 1000);

app.on('child-process-gone', (_e, d) => {
  const s = `child-process-gone type=${d.type} reason=${d.reason} exitCode=${d.exitCode} name=${d.name || ''}`;
  results.events.push(s); log(s);
});
app.on('render-process-gone', (_e, _wc, d) => {
  const s = `render-process-gone reason=${d.reason} exitCode=${d.exitCode}`;
  results.events.push(s); log(s);
});

function check(name, pass, detail) {
  results.checks.push({ name, pass: !!pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

function within(name, m, target, tol) {
  if (m.error) { check(name, false, `target ${target}: ${m.error}`); return; }
  const err = (m.fps - target) / target;
  check(name, Math.abs(err) <= tol,
    `target ${target} got ${m.fps.toFixed(2)} (${(err * 100).toFixed(2)} %, tol ${(tol * 100).toFixed(0)} %)`);
}

function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`TIMEOUT (${what}) - window froze?`)), ms); })])
    .finally(() => clearTimeout(t));
}

async function measure(wc, name, ms = WINDOW_MS) {
  let m;
  try {
    m = await withTimeout(wc.executeJavaScript(`kcc.measure(${ms})`), ms + 10000, name);
  } catch (e) {
    m = { label: '?', fps: 0, error: String(e && e.message ? e.message : e) };
  }
  m.name = name;
  results.measurements.push(m);
  log(`measure ${name}: ${m.error ? m.error : `${m.fps.toFixed(2)} fps (${m.frames} frames / ${m.elapsedMs.toFixed(0)} ms; ` +
    `interval mean ${m.meanMs.toFixed(3)} sd ${m.sdMs.toFixed(3)} p50 ${m.p50Ms.toFixed(3)} p99 ${m.p99Ms.toFixed(3)} max ${m.maxMs.toFixed(2)} ms)`}`);
  return m;
}

async function hideShow(win) {
  win.hide();
  await sleep(1000);
  win.show();
  win.focus();
  await sleep(1500);
}

async function resize(win, w, h) {
  win.setContentSize(w, h);
  await sleep(1000);
}

// ---- per-thread CPU time of a process (Windows), via thread-cpu.ps1 --------
function threadTimes(pid) {
  const out = execFileSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'thread-cpu.ps1'), '-ProcessId', String(pid)],
    { encoding: 'utf8', timeout: 60000 });
  return JSON.parse(out);
}

function cpuDelta(a, b) {
  const wallS = (b.ticks - a.ticks) / 1e7;
  const before = new Map(a.threads.map((t) => [t.tid, t]));
  const rows = [];
  for (const t of b.threads) {
    const t0 = before.get(t.tid);
    const cpu = (t.cpu100ns - (t0 ? t0.cpu100ns : 0)) / 1e7;
    rows.push({ tid: t.tid, name: t.name, cpuS: cpu, pctOfCore: 100 * cpu / wallS });
  }
  rows.sort((x, y) => y.cpuS - x.cpuS);
  const processPct = 100 * ((b.processCpu100ns - a.processCpu100ns) / 1e7) / wallS;
  return { wallS, processPctOfCore: processPct, threads: rows.slice(0, 12) };
}

// ---- suites ------------------------------------------------------------------
async function suiteLaunch(win) {
  const wc = win.webContents;
  if (!CAP) throw new Error('launch suite needs --kcc-cap');
  within(`launch CustomFrameCap:fps/${CAP}`, await measure(wc, `launch ${CAP}`), CAP, TOL);
  await hideShow(win);
  within(`launch cap ${CAP} after hide/show`, await measure(wc, `launch ${CAP} after hide/show`), CAP, TOL);
  await resize(win, 800, 600);
  within(`launch cap ${CAP} after resize`, await measure(wc, `launch ${CAP} after resize`), CAP, TOL);
  await resize(win, 640, 480);
  win.setFrameCap(0);
  await sleep(500);
  const un = await measure(wc, 'setFrameCap(0) after launch cap');
  // Uncapped must clearly exceed the launch cap. Where this machine's ceiling is
  // close to the cap this cannot discriminate; the runtime suite also uncaps
  // from 60, which always can.
  check('setFrameCap(0) uncaps a launch cap', !un.error && un.fps > CAP * 1.05,
    `launch cap ${CAP}, got ${un.fps.toFixed(2)} (must exceed ${(CAP * 1.05).toFixed(0)})`);
  win.setFrameCap(CAP);
  await sleep(500);
  within(`setFrameCap(${CAP}) re-caps`, await measure(wc, `re-cap ${CAP}`), CAP, TOL);
}

// A cap the page cannot reach uncapped says nothing about cap accuracy; such
// caps are recorded as skipped, not as failures.
function skip(name, why) {
  results.skipped = results.skipped || [];
  results.skipped.push({ name, why });
  log(`SKIP  ${name}  ${why}`);
}

async function suiteRuntime(win) {
  const wc = win.webContents;
  const base = await measure(wc, 'uncapped baseline');
  results.uncappedBaseline = base.fps;
  const reachable = (n) => base.fps >= n * 1.1;
  for (const n of [60, 144, 240]) {
    if (!reachable(n)) { skip(`setFrameCap(${n})`, `uncapped baseline ${base.fps.toFixed(1)} is below 1.1 x ${n}`); continue; }
    win.setFrameCap(n);
    await sleep(500);
    within(`setFrameCap(${n})`, await measure(wc, `setFrameCap(${n})`), n, TOL);
  }
  win.setFrameCap(144);
  await sleep(500);
  await hideShow(win);
  within('setFrameCap(144) after hide/show', await measure(wc, '144 after hide/show'), 144, TOL);
  await resize(win, 800, 600);
  within('setFrameCap(144) after resize', await measure(wc, '144 after resize'), 144, TOL);
  await resize(win, 640, 480);
  // A change of N takes effect at once: measure from the next frame on.
  const hi = reachable(240) ? 240 : 100;
  win.setFrameCap(hi);
  within(`change 144 -> ${hi} takes effect at once (2 s)`, await measure(wc, `at once ${hi}`, 2000), hi, TOL_SHORT);
  win.setFrameCap(60);
  within(`change ${hi} -> 60 takes effect at once (2 s)`, await measure(wc, 'at once 60', 2000), 60, TOL_SHORT);
  win.setFrameCap(144);
  within('change 60 -> 144 takes effect at once (2 s)', await measure(wc, 'at once 144', 2000), 144, TOL_SHORT);
  win.setFrameCap(60);
  await sleep(500);
  win.setFrameCap(0);
  await sleep(500);
  const un = await measure(wc, 'setFrameCap(0)');
  check('setFrameCap(0) returns to uncapped (from 60)', !un.error && un.fps > 90 && un.fps >= 0.8 * base.fps,
    `baseline ${base.fps.toFixed(2)}, after setFrameCap(0) ${un.fps.toFixed(2)} (must exceed 90 and 80 % of baseline)`);

  // A second animating view in the same window.
  const view2 = new WebContentsView({ webPreferences: { backgroundThrottling: false } });
  win.contentView.addChildView(view2);
  view2.setBounds({ x: 320, y: 0, width: 320, height: 480 });
  await view2.webContents.loadFile(path.join(__dirname, 'frame-cap.html'), { query: { label: 'second', mode: MODE } });
  await sleep(1500);
  const both = async (name) => {
    const [a, b] = await Promise.all([measure(wc, `${name} main`), measure(view2.webContents, `${name} second`)]);
    return [a, b];
  };
  const [u1, u2] = await both('two views uncapped');
  results.twoViewsUncapped = [u1.fps, u2.fps];
  for (const n of [144, 60]) {
    if (Math.min(u1.fps, u2.fps) < n * 1.1) { skip(`two views, cap ${n}`, `two-view uncapped rate ${Math.min(u1.fps, u2.fps).toFixed(1)} is below 1.1 x ${n}`); continue; }
    win.setFrameCap(n);
    await sleep(500);
    const [m1, m2] = await both(`two views cap ${n}`);
    within(`two views, cap ${n}: main view`, m1, n, TOL);
    within(`two views, cap ${n}: second view`, m2, n, TOL);
  }
  win.setFrameCap(0);
  await sleep(500);
  const [v1, v2] = await both('two views setFrameCap(0)');
  check('two views: setFrameCap(0) uncaps both (from 60)', !v1.error && !v2.error && v1.fps > 90 && v2.fps > 90 &&
    v1.fps >= 0.8 * u1.fps && v2.fps >= 0.8 * u2.fps,
    `uncapped before ${u1.fps.toFixed(2)} / ${u2.fps.toFixed(2)}, after setFrameCap(0) ${v1.fps.toFixed(2)} / ${v2.fps.toFixed(2)}`);
  win.contentView.removeChildView(view2);
  view2.webContents.close();
}

async function suiteHeavy(win) {
  const wc = win.webContents;
  if (!BUSY) throw new Error('heavy suite needs --kcc-busy');
  win.setFrameCap(0);
  await sleep(500);
  const reach = await measure(wc, `uncapped, busy ${BUSY} ms`);
  results.reach = reach.fps;
  for (const n of [1000, 240]) {
    win.setFrameCap(n);
    await sleep(500);
    const m = await measure(wc, `cap ${n}, busy ${BUSY} ms`);
    results[`cap${n}`] = m.fps;
    if (reach.fps < n * 0.97) {
      // Not gated here: the ported cap (c03) already costs some throughput when
      // it is set above reach. The gate is the comparison with the same suite
      // run with the c60/c61 switches off (run-frame-cap-gate.ps1).
      check(`cap ${n} above reach (${reach.fps.toFixed(0)}): window did not freeze`, !m.error && m.fps > 0.5 * reach.fps,
        `uncapped ${reach.fps.toFixed(2)}, capped ${m.fps.toFixed(2)} (${((m.fps / reach.fps - 1) * 100).toFixed(2)} % vs uncapped, informational)`);
    } else {
      within(`cap ${n} (reachable, busy ${BUSY} ms)`, m, n, TOL);
    }
  }
  win.setFrameCap(144);
  await sleep(500);
  const m144 = await measure(wc, `cap 144, busy ${BUSY} ms`);
  results.cap144 = m144.fps;
  if (reach.fps > 144 * 1.05) within(`cap 144 with busy ${BUSY} ms page`, m144, 144, TOL);
  win.setFrameCap(0);
}

// c61: how long a frame the renderer has submitted waits in viz before the
// display draws it. Recorded with contentTracing (cc, viz, benchmark):
//   renderer: Scheduler::BeginImplFrame (start of the impl frame),
//             ProxyImpl::ScheduledActionDraw (end = frame submitted)
//   gpu:      Display::DrawAndSwap (start = display draws)
// Each renderer draw is paired with the first display draw that starts after
// it. The patch description predicts, under a cap of period P with a renderer
// that needs r: wait ~ P - r without KccFrameCapLateLatch and ~0 with it.
function pct(a, p) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; }
async function suiteLatency(win) {
  const wc = win.webContents;
  const cap = CAP || 144;
  win.setFrameCap(cap);
  await sleep(1500);
  const tracePath = OUT ? OUT.replace(/\.json$/, '') + '-trace.json' : path.join(app.getPath('temp'), 'kcc-latency-trace.json');
  await contentTracing.startRecording({ included_categories: ['cc', 'viz', 'benchmark'], excluded_categories: ['*'] });
  const m = await measure(wc, `latency window, cap ${cap}`, 4000);
  const file = await contentTracing.stopRecording(tracePath);
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ev = Array.isArray(t) ? t : t.traceEvents;
  const rpid = wc.getOSProcessId();
  const gpu = app.getAppMetrics().find((x) => x.type === 'GPU');
  const gpid = gpu ? gpu.pid : -1;
  const ts = (name, pid, end) => ev.filter((e) => e.name === name && e.pid === pid && e.ph === 'X')
    .map((e) => (end ? e.ts + (e.dur || 0) : e.ts) / 1000).sort((a, b) => a - b);
  const bif = ts('Scheduler::BeginImplFrame', rpid, false);
  // BeginMainFrame is where input is dispatched and rAF runs. An impl draw
  // contains the content of the last main frame that had finished before the
  // draw started (cc draws the previous tree while a slow main frame is still
  // running), so pair on [start, end] of both.
  const bmf = ev.filter((e) => e.name === 'ProxyMain::BeginMainFrame' && e.pid === rpid && e.ph === 'X')
    .map((e) => ({ s: e.ts / 1000, e: (e.ts + (e.dur || 0)) / 1000 })).sort((a, b) => a.e - b.e);
  const draws = ev.filter((e) => e.name === 'ProxyImpl::ScheduledActionDraw' && e.pid === rpid && e.ph === 'X')
    .map((e) => ({ s: e.ts / 1000, e: (e.ts + (e.dur || 0)) / 1000 })).sort((a, b) => a.s - b.s);
  const sub = draws.map((d) => d.e);
  const disp = ts('Display::DrawAndSwap', gpid, false);
  const waits = [], renders = [], totals = [], mainToDraw = [];
  let di = 0, bi = 0, mi = -1;
  for (const d of draws) {
    const s = d.e;
    while (di < disp.length && disp[di] < s) di++;
    if (di >= disp.length) break;
    while (bi + 1 < bif.length && bif[bi + 1] <= s) bi++;
    while (mi + 1 < bmf.length && bmf[mi + 1].e <= d.s) mi++;
    waits.push(disp[di] - s);
    if (bif.length && bif[bi] <= s) { renders.push(s - bif[bi]); totals.push(disp[di] - bif[bi]); }
    if (mi >= 0) mainToDraw.push(disp[di] - bmf[mi].s);
  }
  const P = 1000 / cap;
  const lat = {
    cap, periodMs: P, renderer: rpid, gpu: gpid,
    counts: { beginImplFrame: bif.length, beginMainFrame: bmf.length, rendererDraws: sub.length, displayDraws: disp.length, paired: waits.length },
    submitToDisplayDrawMs: { p10: pct(waits, 0.1), p50: pct(waits, 0.5), p90: pct(waits, 0.9) },
    beginImplFrameToSubmitMs: { p50: pct(renders, 0.5), p90: pct(renders, 0.9) },
    beginImplFrameToDisplayDrawMs: { p10: pct(totals, 0.1), p50: pct(totals, 0.5), p90: pct(totals, 0.9) },
    // input age at the display draw: start of the main frame whose content it shows
    beginMainFrameToDisplayDrawMs: { p10: pct(mainToDraw, 0.1), p50: pct(mainToDraw, 0.5), p90: pct(mainToDraw, 0.9) },
    mainFrameMs: { p50: pct(bmf.map((b) => b.e - b.s), 0.5) },
  };
  results.latency = lat;
  log(`latency: ${JSON.stringify(lat)}`);
  if (!app.commandLine.hasSwitch('kcc-keep-trace')) {
    try { fs.unlinkSync(file); } catch (e) { /* keep going */ }
  } else {
    results.traceFile = file;
  }
  within(`latency suite: cap ${cap} holds`, m, cap, TOL);
  check('latency suite: trace has renderer and display draws', waits.length > 100 && mainToDraw.length > 100,
    `paired ${waits.length} renderer draws with display draws`);
  win.setFrameCap(0);
}

async function suiteCpu(win) {
  const wc = win.webContents;
  const cap = CAP || 144;
  win.setFrameCap(cap);
  await sleep(1500);
  const gpu = app.getAppMetrics().find((m) => m.type === 'GPU');
  if (!gpu) throw new Error('no GPU process in app.getAppMetrics()');
  const a = threadTimes(gpu.pid);
  const m = await measure(wc, `cpu suite, cap ${cap}`);
  const b = threadTimes(gpu.pid);
  const d = cpuDelta(a, b);
  results.cpu = d;
  const viz = d.threads.find((t) => t.name === 'VizCompositorThread');
  results.vizCompositorPctOfCore = viz ? viz.pctOfCore : null;
  log(`GPU process ${gpu.pid}: ${d.processPctOfCore.toFixed(1)} % of a core over ${d.wallS.toFixed(2)} s`);
  for (const t of d.threads.slice(0, 6)) log(`  ${t.name || '(unnamed)'} [${t.tid}]: ${t.pctOfCore.toFixed(1)} %`);
  within(`cpu suite: cap ${cap} holds`, m, cap, TOL);
  check('cpu suite: VizCompositorThread found', !!viz, viz ? `${viz.pctOfCore.toFixed(1)} % of a core` : 'thread names: ' + d.threads.map((t) => t.name).join(','));
  win.setFrameCap(0);
}

app.whenReady().then(async () => {
  try {
    results.gpuFeatureStatus = app.getGPUFeatureStatus();
    const win = new BrowserWindow({
      width: 640, height: 480, useContentSize: true, show: true,
      webPreferences: { backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true);
    await win.loadFile(path.join(__dirname, 'frame-cap.html'), { query: { busy: String(BUSY), label: 'main', mode: MODE } });
    const wc = win.webContents;
    results.pageRenderer = await wc.executeJavaScript('kcc.renderer');
    try {
      const info = await app.getGPUInfo('basic');
      results.gpuDevices = (info.gpuDevice || []).map((g) => ({ vendorId: g.vendorId, deviceId: g.deviceId, active: g.active }));
    } catch (e) { results.gpuDevices = String(e); }
    if (typeof win.setFrameCap !== 'function') {
      check('win.setFrameCap exists', false, 'BaseWindow.setFrameCap is missing: e01 not in this build');
      return finish(1);
    }
    await sleep(1500);
    const f0 = await wc.executeJavaScript('kcc.frames()');
    await sleep(1000);
    const f1 = await wc.executeJavaScript('kcc.frames()');
    if (f1 === f0) {
      results.events.push('NO FRAMES: rAF did not run (desktop session locked or disconnected?)');
      log('NO FRAMES: rAF did not run in 1 s - is the desktop session active?');
      return finish(3);
    }
    log(`page renderer ${results.pageRenderer}; gpu feature status ${JSON.stringify(results.gpuFeatureStatus)}`);
    if (SUITE === 'launch') await suiteLaunch(win);
    else if (SUITE === 'runtime') await suiteRuntime(win);
    else if (SUITE === 'heavy') await suiteHeavy(win);
    else if (SUITE === 'cpu') await suiteCpu(win);
    else if (SUITE === 'latency') await suiteLatency(win);
    else throw new Error(`unknown suite ${SUITE}`);
    await sleep(300);
    finish(results.checks.every((c) => c.pass) && !results.events.some((e) => e.startsWith('child-process-gone') || e.startsWith('render-process-gone')) ? 0 : 1);
  } catch (e) {
    results.events.push(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    log(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    finish(2);
  }
});
