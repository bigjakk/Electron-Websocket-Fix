// Synthetic checks for the drafted patches of the KCC Electron 45 series, for
// macOS and Linux: the Node port of run-checks.ps1, with the same runs and pass
// rules. Each check runs the same binary with the patch's switch off and on.
//
//   node posix-run-checks.js --exe <electron> --out <dir>
//       [--only c10,c11,raw,e10,c21,v01,c20,c40,c41,c60,lat] [--cap-page-mode webgl|2d]
//   ("c20" also reports c30 and c31; "lat" is informational: input age under a
//    144 cap, no switch.)
//
// Windows only, reported as N/A here and not counted as failures:
//   raw  c12-c15 through raw-input-test.js, which injects input with SendInput
//        (send-input.ps1)
//   c60  KccFrameCapPreciseRelease and the cpu suite (thread-cpu.ps1)
// c31 (KccCacheVsyncInterval) patches the Windows DComp vsync provider; its
// trace counter never fires on this OS, so the c20 run reports it as N/A.
//
// Writes one log / JSON per run into --out and a summary.txt. A check that
// cannot be exercised on this machine says so instead of passing.
'use strict';
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const k = require('./posix-kcc-flags');

const ALL = 'c10,c11,raw,e10,c21,v01,c20,c40,c41,c60,lat';

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

  // ---- e10: skip unobserved input emits ---------------------------------------
  if (only.includes('e10')) {
    for (const mode of ['off', 'on']) {
      const f = mode === 'on' ? k.joinKccFeatures(['KccSkipUnobservedInputEmits']) : [];
      const r = await run(`e10-emit-${mode}`, ['input-emit-test.js', `--kcc-out=${out(`e10-emit-${mode}.json`)}`, ...f]);
      const n = checksOf(r).length;
      const failed = failedOf(r, true);
      verdict('e10', clean(r), `KccSkipUnobservedInputEmits ${mode}: exit ${r.code}, ${n - failed.length}/${n} checks${failNote(failed)}${crashNote(r)}`);
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

  // ---- raw (c12-c15) and c60: Windows only --------------------------------------
  if (only.includes('raw') && process.platform !== 'win32') {
    na('raw', 'c12-c15: raw-input-test.js injects relative packets with SendInput (send-input.ps1, Windows only); not checked on this OS');
  }
  if (only.includes('c60') && process.platform !== 'win32') {
    na('c60', 'KccFrameCapPreciseRelease is Windows-only, and its check reads per-thread CPU time with thread-cpu.ps1; not checked on this OS');
  }

  // ---- c21: WebGL fast API calls vs --no-turbo-fast-api-calls ------------------
  if (only.includes('c21')) {
    const A = await run('c21-webgl-fast', ['webgl-fast-api-test.js', `--kcc-out=${out('c21-webgl-fast.json')}`, '--js-flags=--allow-natives-syntax']);
    const B = await run('c21-webgl-nofast', ['webgl-fast-api-test.js', `--kcc-out=${out('c21-webgl-nofast.json')}`, '--js-flags=--allow-natives-syntax --no-turbo-fast-api-calls']);
    const C = await run('c21-webgl-fast-allflags', ['webgl-fast-api-test.js', `--kcc-out=${out('c21-webgl-fast-allflags.json')}`,
      `--js-flags=--allow-natives-syntax ${k.KCC_ALL_JS_FLAGS}`, ...k.joinKccFeatures(k.KCC_ALL_FEATURES)]);
    const pa = (A.res && A.res.page) || null;
    const pb = (B.res && B.res.page) || null;
    const pc = (C.res && C.res.page) || null;
    const same = !!(pa && pb && !pa.error && pa.errHash === pb.errHash && pa.pixHash === pb.pixHash &&
      JSON.stringify(pa.errCounts) === JSON.stringify(pb.errCounts));
    const sameC = !!(pc && pb && pc.errHash === pb.errHash && pc.pixHash === pb.pixHash);
    const tf = !!(pa && pb && pa.turbofannedBeforeLoop && pa.turbofannedAfterLoop && pb.turbofannedAfterLoop);
    const g = (p, key) => (p ? p[key] : undefined);
    verdict('c21', clean(A) && clean(B) && clean(C) && same && sameC && tf,
      `fast: err ${g(pa, 'errHash')} pix ${g(pa, 'pixHash')} errors ${g(pa, 'errTotal')} ${JSON.stringify(g(pa, 'errCounts'))} loop ${Math.round(g(pa, 'loopMs'))} ms ` +
      `turbofan ${g(pa, 'turbofannedBeforeLoop')}/${g(pa, 'turbofannedAfterLoop')}; no-fast: err ${g(pb, 'errHash')} pix ${g(pb, 'pixHash')} loop ${Math.round(g(pb, 'loopMs'))} ms; ` +
      `all flags: err ${g(pc, 'errHash')} pix ${g(pc, 'pixHash')}; WebGL context lost ${g(pa, 'contextLost')}/${g(pb, 'contextLost')}/${g(pc, 'contextLost')}; ` +
      `renderer ${g(pa, 'renderer')}${crashNote(A)}${crashNote(B)}${crashNote(C)}`);
  }

  // ---- v01: cppgc incremental sweep slice --------------------------------------
  if (only.includes('v01')) {
    let opts = '';
    try {
      opts = execFileSync(a.exe, ['--v8-options'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', maxBuffer: 64 << 20 });
    } catch (e) {
      opts = `${e.stdout || ''}${e.stderr || ''}`;
    }
    fs.writeFileSync(out('v01-v8-options.txt'), opts);
    const lines = opts.split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes('cppheap-max-incremental-sweep-duration-ms'));
    const text = at >= 0 ? lines.slice(at, at + 3).map((l) => l.trim()).join(' ') : 'not listed';
    verdict('v01', at >= 0, `flag listed by --v8-options: ${text}`);
    for (const ms of [0, 1, 2]) {
      const name = `v01-sweep-${ms}`;
      const args = ['v8-sweep-flag-test.js', `--kcc-out=${out(`${name}.json`)}`, `--kcc-trace=${out(`${name}-trace.json`)}`];
      if (ms === 0) args.push('--kcc-expect-ms=5');
      else args.push(`--kcc-expect-ms=${ms}`, `--js-flags=--cppheap-max-incremental-sweep-duration-ms=${ms}`);
      const r = await run(name, args);
      const unknown = fs.readFileSync(r.log, 'utf8').split(/\r?\n/).find((l) => /unrecognized flag|unknown flag|Error: .*cppheap/i.test(l));
      const slices = r.res ? JSON.stringify(r.res.sweepSlices) : 'no result';
      verdict('v01', clean(r) && !unknown, `${ms ? `--cppheap-max-incremental-sweep-duration-ms=${ms}` : 'no flag (stock 5 ms)'}: exit ${r.code}; ` +
        `slices ${slices}${unknown ? ` | V8: ${unknown.trim()}` : ''}${crashNote(r)}`);
      fs.rmSync(out(`${name}-trace.json`), { force: true });  // large; the counts are in the JSON
    }
  }

  // ---- c20 / c30 / c31: canvas and texture page --------------------------------
  if (only.includes('c20')) {
    const res = {};
    for (const mode of ['off', 'on']) {
      const name = `c20-c30-c31-${mode}`;
      const f = mode === 'on' ? k.joinKccFeatures(['KccSkipCanvasPerfSampling', 'KccLabelTexturesOnce', 'KccCacheVsyncInterval']) : [];
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
      res[mode] = { r, rm, vi, vp, frames: p.frames, glError: p.glError, lost: p.contextLost };
      const gc = r.res && r.res.gpuFeatureStatus ? r.res.gpuFeatureStatus.gpu_compositing : undefined;
      say(`       c20/c30/c31 flags ${mode}: exit ${r.code}, ${p.frames} frames (${k.fix(p.fps, 1)} fps), glError ${p.glError}, WebGL context lost ${p.contextLost}, ` +
        `RecordMetrics ${rm}, GetVSyncIntervalIfAvailable ${vi}, GetVSyncParameters ${vp}, gpu_compositing ${gc}${crashNote(r)}`);
    }
    const bothClean = clean(res.off.r) && clean(res.on.r);
    verdict('c20', bothClean && res.off.rm > 0 && res.on.rm === 0, `RecordMetrics slices: off ${res.off.rm}, on ${res.on.rm} (must be > 0 and 0)`);
    verdict('c30', bothClean && res.on.glError === 0 && res.on.frames > 0 && res.on.lost === false,
      `texture-rebind page ran without crash or DCHECK, glError ${res.on.glError}, WebGL context lost ${res.on.lost}, ${res.on.frames} frames with KccLabelTexturesOnce ` +
      '(no counter for the skipped labels in a trace)');
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

  // ---- c41: HRTF panner k-rate angles, bit identity ----------------------------
  if (only.includes('c41')) {
    const h = [];
    for (const runName of ['off-1', 'off-2', 'on-1', 'on-2']) {
      const name = `c41-hrtf-${runName}`;
      const f = runName.startsWith('on') ? k.joinKccFeatures(['KccHrtfPannerKRateAngles']) : [];
      const raw = out(`${name}.f32`);
      const r = await run(name, ['page-check.js', '--kcc-page=hrtf.html', `--kcc-out=${out(`${name}.json`)}`, `--kcc-raw-out=${raw}`, ...f]);
      let sha = 'missing';
      try { sha = crypto.createHash('sha256').update(fs.readFileSync(raw)).digest('hex').toUpperCase(); } catch { /* no buffer */ }
      const p = (r.res && r.res.result) || {};
      h.push({ r, sha, nonZero: p.nonZero });
      say(`       c41 ${runName}: exit ${r.code}, sample hash ${p.hash}, sha256 ${sha.slice(0, 16)}, non-zero samples ${p.nonZero}${crashNote(r)}`);
    }
    const shas = [...new Set(h.map((x) => x.sha))];
    const ok = h.every((x) => clean(x.r)) && shas.length === 1 && shas[0] !== 'missing' && h[0].nonZero > 0;
    verdict('c41', ok, `4 renders (off x2, on x2): ${shas.length} distinct buffer(s); identical sample for sample: ${shas.length === 1}`);
    for (const f of fs.readdirSync(a.out)) if (/^c41-hrtf-.*\.f32$/.test(f)) fs.rmSync(out(f));  // 7.7 MB each
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
