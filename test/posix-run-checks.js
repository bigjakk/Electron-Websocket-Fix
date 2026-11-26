// Synthetic checks for the drafted patches of the KCC Electron 45 series, for
// macOS and Linux: the Node port of run-checks.ps1, with the same runs and pass
// rules. Each check runs the same binary with the patch's switch off and on.
//
//   node posix-run-checks.js --exe <electron> --out <dir>
//       [--only c10,c11,c20,c40,c60,lat] [--cap-page-mode webgl|2d]
//   ("c20" also reports c31; "lat" is informational: input age under a 144 cap,
//    no switch.)
//
// Windows only, reported as N/A here and not counted as failures:
//   c60  KccFrameCapPreciseRelease and the cpu suite (thread-cpu.ps1)
// c31 (KccCacheVsyncInterval) patches the Windows DComp vsync provider; its
// trace counter never fires on this OS, so the c20 run reports it as N/A.
//
// Writes one log / JSON per run into --out and a summary.txt. A check that
// cannot be exercised on this machine says so instead of passing.
'use strict';
const fs = require('fs');
const path = require('path');
const k = require('./posix-kcc-flags');

const ALL = 'c10,c11,c20,c40,c60,lat';

async function main(argv) {
  const a = k.parseArgs(argv, { only: ALL, 'cap-page-mode': 'webgl' });
  if (!a.exe || !a.out) {
    console.log(`usage: node posix-run-checks.js --exe <electron> --out <dir> [--only ${ALL}] [--cap-page-mode webgl|2d]`);
    return 2;
  }
  const only = k.list(a.only);
  k.keepAwake();
  fs.mkdirSync(a.out, { recursive: true });
  const say = k.makeSummary(path.join(a.out, 'summary.txt'),
    `synthetic checks  ${k.stamp()}\nexe: ${a.exe}\nchecks: ${only.join(',')}\n${k.machineNotes()}\n`);
  let allPass = true;
  const verdict = (name, ok, detail) => {
    if (!ok) allPass = false;
    say(`${name.padEnd(6)} ${(ok ? 'PASS' : 'FAIL').padEnd(5)} ${detail}`);
  };
  const na = (name, detail) => say(`${name.padEnd(6)} N/A   ${detail}`);
  const out = (f) => path.join(a.out, f);
  // One check run. A run after which the display was asleep or locked (macOS) is
  // invalid: reported, not counted, and run again (up to 3 attempts); with no
  // valid attempt the checks end INCOMPLETE.
  const invalidRuns = [];
  async function run(name, args) {
    const log = out(`${name}.log`);
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) {
        fs.renameSync(log, out(`${name}-try${attempt - 1}.log`));
        if (fs.existsSync(out(`${name}.json`))) fs.renameSync(out(`${name}.json`), out(`${name}-try${attempt - 1}.json`));
      }
      const code = await k.invokeElectron(a.exe, args, log, { note: say });
      const crash = k.crashLines(log);
      const why = crash.length ? null : k.displayInvalid();
      if (why) {
        say(`  ${name} (attempt ${attempt}) INVALID (${why}) - not counted`);
        if (attempt < 3) continue;
        invalidRuns.push(name);
      }
      return { code, crash, res: k.readJson(out(`${name}.json`)), log, invalid: why };
    }
  }
  const clean = (r) => r.code === 0 && r.crash.length === 0;
  const crashNote = (r) => (r.crash.length ? ` | log: ${r.crash.join(' / ')}` : '');
  const checksOf = (r) => (r.res && Array.isArray(r.res.checks) ? r.res.checks : []);
  const failedOf = (r, withDetail) => (r.res
    ? checksOf(r).filter((c) => !c.pass).map((c) => (withDetail ? `${c.name} (${c.detail})` : c.name))
    : ['no result']);
  const failNote = (f) => (f.length ? `; failed: ${f.join('; ')}` : '');

  // ---- c10: keyup after a browser-handled keydown (ungated back-port) --------
  if (only.includes('c10')) {
    for (const mode of ['off', 'on']) {
      const f = mode === 'on' ? k.joinKccFeatures(k.KCC_ALL_FEATURES) : [];
      const r = await run(`c10-keyup-${mode}`, ['keyup-test.js', `--kcc-out=${out(`c10-keyup-${mode}.json`)}`, ...f]);
      const page = (x) => (x && Array.isArray(x.page) ? x.page.join(', ') : '');
      verdict('c10', clean(r), `flags ${mode}: exit ${r.code}; page saw [${page(r.res && r.res.sendInputEvent)}] via sendInputEvent, ` +
        `[${page(r.res && r.res.cdp)}] via CDP${failNote(failedOf(r, false))}${crashNote(r)}`);
    }
  }

  // ---- c11: pointer-lock Esc cooldown -------------------------------------------
  if (only.includes('c11')) {
    for (const mode of ['off', 'on']) {
      const f = mode === 'on' ? k.joinKccFeatures(['KccNoPointerLockEscCooldown']) : [];
      const r = await run(`c11-pointer-lock-${mode}`, ['pointer-lock-test.js', `--kcc-out=${out(`c11-pointer-lock-${mode}.json`)}`, ...f]);
      const n = checksOf(r).length;
      const failed = failedOf(r, true);
      const re = (r.res && r.res.relockAfterEsc) || {};
      verdict('c11', clean(r), `KccNoPointerLockEscCooldown ${mode}: exit ${r.code}; re-lock ${re.msAfterEsc} ms after Esc: ${re.result}; ` +
        `${n - failed.length}/${n} checks${failNote(failed)}${crashNote(r)}`);
    }
  }

  // ---- c60: Windows only --------------------------------------------------------
  if (only.includes('c60') && process.platform !== 'win32') {
    na('c60', 'KccFrameCapPreciseRelease is Windows-only, and its check reads per-thread CPU time with thread-cpu.ps1; not checked on this OS');
  }

  // ---- c20 / c31: canvas and texture page ---------------------------------------
  if (only.includes('c20')) {
    const res = {};
    for (const mode of ['off', 'on']) {
      const name = `c20-c31-${mode}`;
      const f = mode === 'on' ? k.joinKccFeatures(['KccSkipCanvasPerfSampling', 'KccCacheVsyncInterval']) : [];
      const trace = out(`${name}-trace.json`);
      const r = await run(name, ['page-check.js', '--kcc-page=canvas-texture.html', '--kcc-query=s=8', `--kcc-out=${out(`${name}.json`)}`,
        `--kcc-trace=${trace}`, '--kcc-trace-categories=blink,gpu', ...f]);
      // Slice counts by name, from the trace (page-check.js decodes it).
      const tc = r.res && r.res.traceCounts;
      const count = (n) => (tc && tc[n] != null ? Number(tc[n]) : 0);
      const rm = count('CanvasPerformanceMonitor::RecordMetrics');
      const vi = count('WinVSyncProvider::GetVSyncIntervalIfAvailable');
      const vp = count('WinVSyncProvider::GetVSyncParameters');
      fs.rmSync(trace, { force: true });
      const p = (r.res && r.res.result) || {};
      res[mode] = { r, rm, vi, vp };
      const gc = r.res && r.res.gpuFeatureStatus ? r.res.gpuFeatureStatus.gpu_compositing : undefined;
      say(`       c20/c31 flags ${mode}: exit ${r.code}, ${p.frames} frames (${k.fix(p.fps, 1)} fps), glError ${p.glError}, WebGL context lost ${p.contextLost}, ` +
        `RecordMetrics ${rm}, GetVSyncIntervalIfAvailable ${vi}, GetVSyncParameters ${vp}, gpu_compositing ${gc}${crashNote(r)}`);
    }
    const bothClean = clean(res.off.r) && clean(res.on.r);
    verdict('c20', bothClean && res.off.rm > 0 && res.on.rm === 0, `RecordMetrics slices: off ${res.off.rm}, on ${res.on.rm} (must be > 0 and 0)`);
    if (res.off.vi === 0 && res.on.vi === 0) {
      na('c31', `GetVSyncIntervalIfAvailable never ran (off ${res.off.vi}, on ${res.on.vi}): KccCacheVsyncInterval patches the Windows DComp vsync provider, ` +
        'which this OS does not have; the build ran with it on.');
    } else {
      verdict('c31', res.on.vi < res.off.vi, `GetVSyncIntervalIfAvailable slices: off ${res.off.vi}, on ${res.on.vi}`);
    }
  }

  // ---- c40: AudioParam coalescing ----------------------------------------------
  if (only.includes('c40')) {
    const g = {};
    for (const mode of ['off', 'on']) {
      const name = `c40-audioparam-${mode}`;
      const f = mode === 'on' ? k.joinKccFeatures(['KccAudioParamCoalesce']) : [];
      const r = await run(name, ['page-check.js', '--kcc-page=audioparam.html', `--kcc-out=${out(`${name}.json`)}`, ...f]);
      g[mode] = r;
      const sc = (r.res && r.res.result && r.res.result.scenarios) || [];
      const desc = sc.map((s) => `${s.name} t=${k.fix(s.currentTime, 3)} ${k.fix(s.firstMs, 2)}->${k.fix(s.lastMs, 2)} ms (${k.fix(s.growth, 2)}x)`).join('; ');
      say(`       c40 flags ${mode}: exit ${r.code}: ${desc}${crashNote(r)}`);
    }
    const scen = (r) => (r.res && r.res.result && r.res.result.scenarios) || [];
    const flat = scen(g.on).filter((s) => s.growth > 1.5).length === 0;
    const stockGrows = scen(g.off).filter((s) => s.growth > 3).length;
    verdict('c40', clean(g.off) && clean(g.on) && flat,
      `with the switch every scenario stays flat (growth <= 1.5x): ${flat}; stock grew > 3x in ${stockGrows} of ${scen(g.off).length} scenarios`);
  }

  // ---- lat: input age under a cap, no switch (informational) ---------------------
  if (only.includes('lat')) {
    for (const busy of [0, 3]) {
      const name = `lat-busy${busy}`;
      const r = await run(name, ['frame-cap-test.js', '--kcc-suite=latency', '--kcc-cap=144', `--kcc-busy=${busy}`, `--kcc-mode=${a['cap-page-mode']}`, `--kcc-out=${out(`${name}.json`)}`]);
      const l = (r.res && r.res.latency) || {};
      const fps = r.res && Array.isArray(r.res.measurements) && r.res.measurements[0] ? r.res.measurements[0].fps : undefined;
      if (!clean(r)) allPass = false;
      const q = (o, key) => k.fix(o && o[key], 2);
      say(`lat    INFO  busy ${busy} ms, 144 cap (P 6.94 ms, ${a['cap-page-mode']} page): exit ${r.code}, ${k.fix(fps, 2)} fps; ` +
        `main frame start->DrawAndSwap p10/p50/p90 ${q(l.beginMainFrameToDisplayDrawMs, 'p10')}/${q(l.beginMainFrameToDisplayDrawMs, 'p50')}/${q(l.beginMainFrameToDisplayDrawMs, 'p90')} ms; ` +
        `BeginImplFrame->DrawAndSwap p50 ${q(l.beginImplFrameToDisplayDrawMs, 'p50')} ms; submit->display draw p50 ${q(l.submitToDisplayDrawMs, 'p50')} ms${crashNote(r)}`);
    }
  }

  if (invalidRuns.length) say(`\nno valid attempt (display asleep or locked) for: ${invalidRuns.join(', ')}`);
  const word = invalidRuns.length ? 'INCOMPLETE' : allPass ? 'PASS' : 'SOME FAILED (see above)';
  say(`\nSYNTHETIC CHECKS: ${word}`);
  return allPass && !invalidRuns.length ? 0 : 1;
}

if (require.main === module) k.runMain(main);
module.exports = { main };
