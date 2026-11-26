// Synthetic checks of the KCC Electron 45 series on Linux, the counterpart of
// run-checks.ps1: each check runs the same binary with the patch's switch off
// and on. The checks that apply on every OS are ported as they are; the
// Windows-only ones (c31, c60: the DComp presenter, the cpu suite) are left
// out: the c20 run carries the c31 switch and reports c31 as N/A.
//
//   node linux-run-checks.js --exe <electron> --out <dir>
//        [--only c10,c11,c20,c40]
//        [--software-rendering] [--no-sandbox]
//
// --software-rendering, --no-sandbox: only on a machine that needs them (the
// build VM: no GPU, Ubuntu 24.04); see linux-common.js. Off by default, so a
// run on a desktop with a GPU uses the GPU.
// Runs use the X server in $DISPLAY: a desktop X11 session, or the test server
// of linux-x11-env.sh.
//
// Writes one log / JSON per run into --out and a summary.txt. The last line is
// "SYNTHETIC CHECKS: PASS" or "SYNTHETIC CHECKS: SOME FAILED (see above)".
// Exit code: 0 all passed, 1 a check failed.
'use strict';
const fs = require('fs');
const path = require('path');
const c = require('./linux-common');

const ALL = ['c10', 'c11', 'c20', 'c40'];
const o = c.parseArgs(process.argv.slice(2), { exe: '', out: '', only: ALL.join(',') });
const only = c.list(o.only);
if (!o.exe || !o.out) { console.error('usage: node linux-run-checks.js --exe <electron> --out <dir> [--only ...]'); process.exit(2); }
const OUT = path.resolve(o.out);
const say = c.summaryWriter(path.join(OUT, 'summary.txt'),
  `synthetic checks (Linux)  ${c.stamp()}\nexe: ${o.exe}\nchecks: ${only.join(',')}\nplatform args: ${c.platformArgs().join(' ')}  DISPLAY=${process.env.DISPLAY || ''}\n`);
let allPass = true;
function verdict(name, ok, detail) { if (!ok) allPass = false; say(`${name.padEnd(6)} ${(ok ? 'PASS' : 'FAIL').padEnd(5)} ${detail}`); }
function run(name, argv) {
  const log = path.join(OUT, `${name}.log`);
  const code = c.runElectron(o.exe, argv, log);
  return { code, crash: c.crashLines(log), res: c.readJson(path.join(OUT, `${name}.json`)), log };
}
const clean = (r) => r.code === 0 && r.crash.length === 0;
const crashNote = (r) => (r.crash.length ? ` | log: ${r.crash.join(' / ')}` : '');
const outArg = (name) => `--kcc-out=${path.join(OUT, `${name}.json`)}`;
const failedChecks = (r) => (r.res ? (r.res.checks || []).filter((k) => !k.pass).map((k) => (k.detail ? `${k.name} (${k.detail})` : k.name)) : ['no result']);

// ---- c10: keyup after a browser-handled keydown (ungated back-port) ----------
if (only.includes('c10')) {
  for (const mode of ['off', 'on']) {
    const f = mode === 'on' ? c.joinFeatures(c.KCC_ALL_FEATURES) : [];
    const r = run(`c10-keyup-${mode}`, ['keyup-test.js', outArg(`c10-keyup-${mode}`), ...f]);
    const failed = failedChecks(r);
    verdict('c10', clean(r), `flags ${mode}: exit ${r.code}; page saw [${((r.res || {}).sendInputEvent || {}).page || ''}] via sendInputEvent, [${((r.res || {}).cdp || {}).page || ''}] via CDP${failed.length ? `; failed: ${failed.join('; ')}` : ''}${crashNote(r)}`);
  }
}

// ---- c11: pointer-lock Esc cooldown ------------------------------------------------
if (only.includes('c11')) {
  for (const mode of ['off', 'on']) {
    const f = mode === 'on' ? c.joinFeatures(['KccNoPointerLockEscCooldown']) : [];
    const r = run(`c11-pointer-lock-${mode}`, ['pointer-lock-test.js', outArg(`c11-pointer-lock-${mode}`), ...f]);
    const n = r.res ? (r.res.checks || []).length : 0;
    const failed = failedChecks(r);
    const re = (r.res || {}).relockAfterEsc || {};
    verdict('c11', clean(r), `KccNoPointerLockEscCooldown ${mode}: exit ${r.code}; re-lock ${re.msAfterEsc} ms after Esc: ${re.result}; ${n - (r.res ? failed.length : 0)}/${n} checks${failed.length ? `; failed: ${failed.join('; ')}` : ''}${crashNote(r)}`);
  }
}

// ---- c20 (/ c31): canvas and texture page ------------------------------------------
if (only.includes('c20')) {
  const res = {};
  for (const mode of ['off', 'on']) {
    const name = `c20-c31-${mode}`;
    const f = mode === 'on' ? c.joinFeatures(['KccSkipCanvasPerfSampling', 'KccCacheVsyncInterval']) : [];
    const trace = path.join(OUT, `${name}-trace.json`);
    const r = run(name, ['page-check.js', '--kcc-page=canvas-texture.html', '--kcc-query=s=8', outArg(name), `--kcc-trace=${trace}`, '--kcc-trace-categories=blink,gpu', ...f]);
    const tc = (r.res || {}).traceCounts || {};
    const count = (n) => Number(tc[n] || 0);
    fs.rmSync(trace, { force: true });
    const result = (r.res || {}).result || {};
    res[mode] = { r, rm: count('CanvasPerformanceMonitor::RecordMetrics') };
    say(`       c20 flags ${mode}: exit ${r.code}, ${result.frames} frames (${c.fmt1(result.fps)} fps), glError ${result.glError}, WebGL context lost ${result.contextLost}, RecordMetrics ${res[mode].rm}, gpu_compositing ${((r.res || {}).gpuFeatureStatus || {}).gpu_compositing}${crashNote(r)}`);
  }
  verdict('c20', clean(res.off.r) && clean(res.on.r) && res.off.rm > 0 && res.on.rm === 0, `RecordMetrics slices: off ${res.off.rm}, on ${res.on.rm} (must be > 0 and 0)`);
  say('c31    N/A   Windows-only (DCompPresenter); the "on" run carried KccCacheVsyncInterval, which this build does not know.');
}

// ---- c40: AudioParam coalescing -----------------------------------------------------
if (only.includes('c40')) {
  const g = {};
  for (const mode of ['off', 'on']) {
    const name = `c40-audioparam-${mode}`;
    const f = mode === 'on' ? c.joinFeatures(['KccAudioParamCoalesce']) : [];
    const r = run(name, ['page-check.js', '--kcc-page=audioparam.html', outArg(name), ...f]);
    g[mode] = r;
    const sc = (((r.res || {}).result || {}).scenarios) || [];
    say(`       c40 flags ${mode}: exit ${r.code}: ${sc.map((s) => `${s.name} t=${Number(s.currentTime).toFixed(3)} ${Number(s.firstMs).toFixed(2)}->${Number(s.lastMs).toFixed(2)} ms (${Number(s.growth).toFixed(2)}x)`).join('; ')}${crashNote(r)}`);
  }
  const on = (((g.on.res || {}).result || {}).scenarios) || [];
  const off = (((g.off.res || {}).result || {}).scenarios) || [];
  const flat = on.length > 0 && on.every((s) => s.growth <= 1.5);
  verdict('c40', clean(g.off) && clean(g.on) && flat, `with the switch every scenario stays flat (growth <= 1.5x): ${flat}; stock grew > 3x in ${off.filter((s) => s.growth > 3).length} of ${off.length} scenarios`);
}

say(`\n${allPass ? 'SYNTHETIC CHECKS: PASS' : 'SYNTHETIC CHECKS: SOME FAILED (see above)'}`);
process.exit(allPass ? 0 : 1);
