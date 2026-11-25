// Synthetic checks of the KCC Electron 45 series on Linux, the counterpart of
// run-checks.ps1: each check runs the same binary with the patch's switch off
// and on. The checks that apply on every OS are ported as they are; the
// Windows-only ones (c13, c14, c31, c60: raw-input-test.js / SendInput, the
// DComp presenter, the cpu suite) are replaced by the Linux/X11 ones:
//   c50  x11-window-props-test.js: _NET_WM_BYPASS_COMPOSITOR per window kind
//   c51  x11-raw-mouse-test.js: X11 raw pointer lock through a uinput mouse;
//        the same runs also check c12 and c15, which act on Linux once c51
//        provides a raw lock
//
//   node linux-run-checks.js --exe <electron> --out <dir>
//        [--only c10,c11,e10,c21,v01,c20,c40,c41,c50,c51]
//
// c51 needs the session of linux-x11-env.sh ($DISPLAY and $KCC_VMOUSE_FIFO).
// Writes one log / JSON per run into --out and a summary.txt. A check that
// cannot be exercised on this machine says so instead of passing.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const c = require('./linux-common');

const ALL = ['c10', 'c11', 'e10', 'c21', 'v01', 'c20', 'c40', 'c41', 'c50', 'c51'];
const o = c.parseArgs(process.argv.slice(2), { exe: '', out: '', only: ALL.join(',') });
const only = c.list(o.only);
if (!o.exe || !o.out) { console.error('usage: node linux-run-checks.js --exe <electron> --out <dir> [--only ...]'); process.exit(2); }
const OUT = path.resolve(o.out);
const say = c.summaryWriter(path.join(OUT, 'summary.txt'),
  `synthetic checks (Linux)  ${c.stamp()}\nexe: ${o.exe}\nchecks: ${only.join(',')}\nplatform args: ${c.PLATFORM_ARGS.join(' ')}  DISPLAY=${process.env.DISPLAY || ''}\n`);
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
const jsonc = (x) => JSON.stringify(x);

// ---- c10: keyup after a browser-handled keydown (ungated back-port) ----------
if (only.includes('c10')) {
  for (const mode of ['off', 'on']) {
    const f = mode === 'on' ? c.joinFeatures(c.KCC_ALL_FEATURES) : [];
    const r = run(`c10-keyup-${mode}`, ['keyup-test.js', outArg(`c10-keyup-${mode}`), ...f]);
    const failed = failedChecks(r);
    verdict('c10', clean(r), `flags ${mode}: exit ${r.code}; page saw [${((r.res || {}).sendInputEvent || {}).page || ''}] via sendInputEvent, [${((r.res || {}).cdp || {}).page || ''}] via CDP${failed.length ? `; failed: ${failed.join('; ')}` : ''}${crashNote(r)}`);
  }
}

// ---- e10: skip unobserved input emits -------------------------------------------
if (only.includes('e10')) {
  for (const mode of ['off', 'on']) {
    const f = mode === 'on' ? c.joinFeatures(['KccSkipUnobservedInputEmits']) : [];
    const r = run(`e10-emit-${mode}`, ['input-emit-test.js', outArg(`e10-emit-${mode}`), ...f]);
    const n = r.res ? (r.res.checks || []).length : 0;
    const failed = failedChecks(r);
    verdict('e10', clean(r), `KccSkipUnobservedInputEmits ${mode}: exit ${r.code}, ${n - (r.res ? failed.length : 0)}/${n} checks${failed.length ? `; failed: ${failed.join('; ')}` : ''}${crashNote(r)}`);
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

// ---- c21: WebGL fast API calls vs --no-turbo-fast-api-calls ------------------------
if (only.includes('c21')) {
  const a = run('c21-webgl-fast', ['webgl-fast-api-test.js', outArg('c21-webgl-fast'), '--js-flags=--allow-natives-syntax']);
  const b = run('c21-webgl-nofast', ['webgl-fast-api-test.js', outArg('c21-webgl-nofast'), '--js-flags=--allow-natives-syntax --no-turbo-fast-api-calls']);
  const k = run('c21-webgl-fast-allflags', ['webgl-fast-api-test.js', outArg('c21-webgl-fast-allflags'), `--js-flags=--allow-natives-syntax ${c.KCC_ALL_JS_FLAGS}`, ...c.joinFeatures(c.KCC_ALL_FEATURES)]);
  const pa = (a.res || {}).page; const pb = (b.res || {}).page; const pc = (k.res || {}).page;
  const same = pa && pb && !pa.error && pa.errHash === pb.errHash && pa.pixHash === pb.pixHash && jsonc(pa.errCounts) === jsonc(pb.errCounts);
  const sameC = pc && pb && pc.errHash === pb.errHash && pc.pixHash === pb.pixHash;
  const tf = pa && pb && pa.turbofannedBeforeLoop && pa.turbofannedAfterLoop && pb.turbofannedAfterLoop;
  const P = (p) => p || {};
  verdict('c21', clean(a) && clean(b) && clean(k) && Boolean(same) && Boolean(sameC) && Boolean(tf),
    `fast: err ${P(pa).errHash} pix ${P(pa).pixHash} errors ${P(pa).errTotal} ${jsonc(P(pa).errCounts)} loop ${Math.round(P(pa).loopMs)} ms turbofan ${P(pa).turbofannedBeforeLoop}/${P(pa).turbofannedAfterLoop}; ` +
    `no-fast: err ${P(pb).errHash} pix ${P(pb).pixHash} loop ${Math.round(P(pb).loopMs)} ms; all flags: err ${P(pc).errHash} pix ${P(pc).pixHash}; ` +
    `WebGL context lost ${P(pa).contextLost}/${P(pb).contextLost}/${P(pc).contextLost}; renderer ${P(pa).renderer}${crashNote(a)}${crashNote(b)}${crashNote(k)}`);
}

// ---- v01: cppgc incremental sweep slice ------------------------------------------
if (only.includes('v01')) {
  const opts = spawnSync(o.exe, ['--v8-options'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', maxBuffer: 64 << 20 });
  const text = `${opts.stdout || ''}${opts.stderr || ''}`;
  fs.writeFileSync(path.join(OUT, 'v01-v8-options.txt'), text);
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.includes('cppheap-max-incremental-sweep-duration-ms'));
  verdict('v01', at >= 0, `flag listed by --v8-options: ${at >= 0 ? lines.slice(at, at + 3).map((l) => l.trim()).join(' ') : 'not listed'}`);
  for (const ms of [0, 1, 2]) {
    const name = `v01-sweep-${ms}`;
    const trace = path.join(OUT, `${name}-trace.json`);
    const argv = ['v8-sweep-flag-test.js', outArg(name), `--kcc-trace=${trace}`];
    if (ms === 0) argv.push('--kcc-expect-ms=5'); else argv.push(`--kcc-expect-ms=${ms}`, `--js-flags=--cppheap-max-incremental-sweep-duration-ms=${ms}`);
    const r = run(name, argv);
    const unknown = fs.readFileSync(r.log, 'utf8').split('\n').find((l) => /unrecognized flag|unknown flag|Error: .*cppheap/.test(l));
    verdict('v01', clean(r) && !unknown, `${ms ? `--cppheap-max-incremental-sweep-duration-ms=${ms}` : 'no flag (stock 5 ms)'}: exit ${r.code}; slices ${r.res ? jsonc(r.res.sweepSlices) : 'no result'}${unknown ? ` | V8: ${unknown.trim()}` : ''}${crashNote(r)}`);
    fs.rmSync(trace, { force: true });  // large; the counts are in the JSON
  }
}

// ---- c20 / c30 (/ c31): canvas and texture page ------------------------------------
if (only.includes('c20')) {
  const res = {};
  for (const mode of ['off', 'on']) {
    const name = `c20-c30-c31-${mode}`;
    const f = mode === 'on' ? c.joinFeatures(['KccSkipCanvasPerfSampling', 'KccLabelTexturesOnce', 'KccCacheVsyncInterval']) : [];
    const trace = path.join(OUT, `${name}-trace.json`);
    const r = run(name, ['page-check.js', '--kcc-page=canvas-texture.html', '--kcc-query=s=8', outArg(name), `--kcc-trace=${trace}`, '--kcc-trace-categories=blink,gpu', ...f]);
    const tc = (r.res || {}).traceCounts || {};
    const count = (n) => Number(tc[n] || 0);
    fs.rmSync(trace, { force: true });
    const result = (r.res || {}).result || {};
    res[mode] = { r, rm: count('CanvasPerformanceMonitor::RecordMetrics'), frames: result.frames, fps: result.fps, glError: result.glError, lost: result.contextLost };
    say(`       c20/c30 flags ${mode}: exit ${r.code}, ${result.frames} frames (${c.fmt1(result.fps)} fps), glError ${result.glError}, WebGL context lost ${result.contextLost}, RecordMetrics ${res[mode].rm}, gpu_compositing ${((r.res || {}).gpuFeatureStatus || {}).gpu_compositing}${crashNote(r)}`);
  }
  verdict('c20', clean(res.off.r) && clean(res.on.r) && res.off.rm > 0 && res.on.rm === 0, `RecordMetrics slices: off ${res.off.rm}, on ${res.on.rm} (must be > 0 and 0)`);
  verdict('c30', clean(res.off.r) && clean(res.on.r) && res.on.glError === 0 && res.on.frames > 0 && res.on.lost === false,
    `texture-rebind page ran without crash or DCHECK, glError ${res.on.glError}, WebGL context lost ${res.on.lost}, ${res.on.frames} frames with KccLabelTexturesOnce (no counter for the skipped labels in a trace)`);
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

// ---- c41: HRTF panner k-rate angles, bit identity ------------------------------------
if (only.includes('c41')) {
  const h = [];
  for (const runName of ['off-1', 'off-2', 'on-1', 'on-2']) {
    const name = `c41-hrtf-${runName}`;
    const f = runName.startsWith('on') ? c.joinFeatures(['KccHrtfPannerKRateAngles']) : [];
    const raw = path.join(OUT, `${name}.f32`);
    const r = run(name, ['page-check.js', '--kcc-page=hrtf.html', outArg(name), `--kcc-raw-out=${raw}`, ...f]);
    const sha = fs.existsSync(raw) ? crypto.createHash('sha256').update(fs.readFileSync(raw)).digest('hex').toUpperCase() : 'missing';
    const result = (r.res || {}).result || {};
    h.push({ run: runName, r, sha, nonZero: result.nonZero });
    say(`       c41 ${runName}: exit ${r.code}, sample hash ${result.hash}, sha256 ${sha.slice(0, 16)}, non-zero samples ${result.nonZero}${crashNote(r)}`);
    fs.rmSync(raw, { force: true });  // 7.7 MB each; the SHA-256 identifies them
  }
  const shas = [...new Set(h.map((x) => x.sha))];
  verdict('c41', h.every((x) => clean(x.r)) && shas.length === 1 && shas[0] !== 'missing' && h[0].nonZero > 0, `4 renders (off x2, on x2): ${shas.length} distinct buffer(s); identical sample for sample: ${shas.length === 1}`);
}

// ---- c50: _NET_WM_BYPASS_COMPOSITOR ------------------------------------------------
if (only.includes('c50')) {
  const r50 = {};
  for (const [mode, f] of [['off', []], ['on', ['KccX11AllowUnredirect']], ['all', c.KCC_ALL_FEATURES]]) {
    const name = `c50-x11-props-${mode}`;
    const r = run(name, ['x11-window-props-test.js', outArg(name), ...c.joinFeatures(f)]);
    r50[mode] = r;
    const ws = (r.res || {}).windows || [];
    say(`       c50 ${mode}: exit ${r.code}; ${ws.map((w) => `${w.kind} ${w.bypassCompositor} (override-redirect ${w.overrideRedirect}, depth ${w.depth})`).join(', ')}${crashNote(r)}`);
  }
  const vals = (mode) => Object.fromEntries((((r50[mode].res || {}).windows) || []).map((w) => [w.kind, w.bypassCompositor]));
  const want = { ordinary: 1, transparent: 2, 'non-focusable': 2 };
  const off = vals('off');
  verdict('c50', clean(r50.off) && Object.keys(want).every((k) => off[k] === 2), `switch off: ${jsonc(off)} (stock: 2 on every window)`);
  for (const mode of ['on', 'all']) {
    const v = vals(mode);
    verdict('c50', clean(r50[mode]) && Object.keys(want).every((k) => v[k] === want[k]), `${mode === 'on' ? 'KccX11AllowUnredirect' : 'every switch'}: ${jsonc(v)} (must be ${jsonc(want)}). No compositor here: only the hint is checked, not unredirection`);
  }
}

// ---- c51 (+ c12, c15 on X11): raw pointer lock through the uinput mouse ----------
if (only.includes('c51')) {
  if (!process.env.DISPLAY || !process.env.KCC_VMOUSE_FIFO) {
    say('c51    N/A   needs the linux-x11-env.sh session (DISPLAY and KCC_VMOUSE_FIFO unset); c12/c15 on X11 not checked either');
    allPass = false;
  } else {
    const cfgs = { off: [], c51: ['KccX11RawMouse'], 'c51+c12': ['KccX11RawMouse', 'KccPinRawPointerLock'], 'c51+c15': ['KccX11RawMouse', 'KccLeanLockedMouseMove'], all: c.KCC_ALL_FEATURES };
    // MouseEvent.buttons histogram of a phase's locked mousemoves: "N moves, buttons {value: count}".
    const btnText = (b) => (b ? `${b.n} moves, buttons ${jsonc(b.hist)}` : 'n/a');
    const btnAll = (b, v) => Boolean(b) && b.n > 0 && Object.keys(b.hist).every((x) => Number(x) === v);
    const R = {};
    for (const [k, f] of Object.entries(cfgs)) {
      const name = `c51-raw-mouse-${k}`;
      const argv = ['x11-raw-mouse-test.js', outArg(name), `--kcc-vmouse-fifo=${process.env.KCC_VMOUSE_FIFO}`, ...c.joinFeatures(f)];
      if (k === 'all') argv.push(`--js-flags=${c.KCC_ALL_JS_FLAGS}`);
      const r = run(name, argv);
      R[k] = r;
      const ph = (r.res || {}).phases || {};
      const m = (p) => (ph[p] && ph[p].stats ? `(${ph[p].stats.mx},${ph[p].stats.my})` : 'n/a');
      say(`       c51 ${k}: exit ${r.code}; lock ${((r.res || {}).lock || {}).kind} [${((r.res || {}).lock || {}).unadjusted}]; flat-fast ${m('flat-fast')} adaptive-fast ${m('adaptive-fast')} adaptive-slow ${m('adaptive-slow')} after-plain-request ${m('after-plain-request')}; ` +
        `xi2 raw ${ph['flat-fast'] && ph['flat-fast'].xi2 ? `${ph['flat-fast'].xi2.rawX},${ph['flat-fast'].xi2.rawY}` : 'n/a'}; drag buttons-0 moves ${ph.drag ? ph.drag.buttonsZeroWhileDown : 'n/a'}/${ph.drag ? ph.drag.movesWhileDown : 'n/a'}; ` +
        `held ${btnText(ph.held && ph.held.buttons)}, after release ${btnText(ph.held && ph.held.afterRelease)}, none ${btnText(ph.none && ph.none.buttons)}` +
        `${(r.res || {}).problems && r.res.problems.length ? ` | problems: ${r.res.problems.join('; ')}` : ''}${crashNote(r)}`);
    }
    const ph = (k) => ((R[k].res || {}).phases) || {};
    const lockOf = (k) => ((R[k].res || {}).lock) || {};
    const exact = (p) => p && p.stats && p.xi2 && p.stats.mx === p.xi2.rawX && p.stats.my === p.xi2.rawY && p.xi2.rawX === p.sent.dx && p.xi2.rawY === p.sent.dy;
    const sums = (k, names) => names.map((n) => `${n} (${ph(k)[n] ? `${ph(k)[n].stats.mx},${ph(k)[n].stats.my}` : 'n/a'})`).join(', ');
    const MOVES = ['flat-fast', 'adaptive-fast', 'adaptive-slow'];
    const escOk = (k) => ph(k).esc && ph(k).esc.lockedBefore && !ph(k).esc.lockedAfter && ph(k).esc.stats.mx === 0 && ph(k).esc.pointer[1].x !== ph(k).esc.pointer[0].x;
    const tabOk = (k) => { const t = ph(k)['alt-tab']; return t && t.lockedBefore && !t.lockedAfter && t.focusAfter !== R[k].res.xid && t.stats.mx === 0 && t.stats.my === 0 && t.focusBack === R[k].res.xid; };

    // Stock (switch off): the request is refused and a plain lock follows the
    // pointer acceleration and the hand speed. Informational, and the control.
    const offL = lockOf('off');
    verdict('c51', clean(R.off) && /NotSupportedError/.test(String(offL.unadjusted)) && offL.kind === 'plain',
      `switch off: unadjustedMovement refused (${offL.unadjusted}); plain lock instead: ${sums('off', MOVES)} for (200,120) device counts each`);
    for (const k of ['c51', 'all']) {
      const L = lockOf(k);
      verdict('c51', clean(R[k]) && L.unadjusted === 'locked' && L.kind === 'raw', `${k === 'c51' ? 'KccX11RawMouse' : 'every switch'}: requestPointerLock({unadjustedMovement:true}) -> ${L.unadjusted}`);
      verdict('c51', clean(R[k]) && MOVES.every((n) => exact(ph(k)[n])),
        `${k}: movement = XInput2 raw device counts in every phase, whatever the acceleration and the speed: ${sums(k, MOVES)} (must all be (200,120))`);
      verdict('c51', clean(R[k]) && L.kind === 'raw' && escOk(k) && tabOk(k),
        `${k}: ${L.kind} lock; Escape released it: ${ph(k).esc ? !ph(k).esc.lockedAfter : 'n/a'}, mouse moved after it: ${ph(k).esc ? ph(k).esc.pointer[1].x !== ph(k).esc.pointer[0].x : 'n/a'}; ` +
        `Alt+Tab released it: ${ph(k)['alt-tab'] ? !ph(k)['alt-tab'].lockedAfter : 'n/a'}, focus to another application: ${ph(k)['alt-tab'] ? ph(k)['alt-tab'].focusAfter !== R[k].res.xid : 'n/a'}, ` +
        `locked movement while it had the focus: ${ph(k)['alt-tab'] ? `(${ph(k)['alt-tab'].stats.mx},${ph(k)['alt-tab'].stats.my})` : 'n/a'} (must be (0,0))`);
      const d = ph(k).drag;
      verdict('c51', clean(R[k]) && L.kind === 'raw' && d && d.lock === 'locked' && d.movesWhileDown > 0 && d.buttonsZeroWhileDown === 0,
        `${k}: ${L.kind} lock taken in mousedown, moved with the button down: ${d ? `${d.buttonsZeroWhileDown} of ${d.movesWhileDown} locked mousemoves had buttons 0 (first ${jsonc(d.firstButtons)}; must be none)` : 'n/a'}`);
      // The desk-check fix: the button state when raw motion starts comes from
      // the pointer, so a button already held reaches the page in buttons.
      const h = ph(k).held; const nb = ph(k).none;
      const heldOk = h && h.lock === 'locked' && jsonc(h.xDownAtLock) === '[1]' && btnAll(h.buttons, 1) && h.stats.mx === 100 &&
        h.afterRelease && jsonc(h.afterRelease.xDown) === '[]' && btnAll(h.afterRelease, 0);
      const noneOk = nb && nb.lock === 'locked' && jsonc(nb.xDownAtLock) === '[]' && btnAll(nb.buttons, 0) && nb.stats.mx === 100 && MOVES.every((n) => btnAll(ph(k)[n] && ph(k)[n].buttons, 0));
      verdict('c51', clean(R[k]) && L.kind === 'raw' && Boolean(heldOk) && Boolean(noneOk),
        `${k}: ${L.kind} lock taken with the left button held (X server: down ${h ? jsonc(h.xDownAtLock) : 'n/a'}): ${btnText(h && h.buttons)} (must all be 1), movement ${h ? h.stats.mx : 'n/a'} (must be 100); ` +
        `after the release: ${btnText(h && h.afterRelease)} (must all be 0); taken with no button held: ${btnText(nb && nb.buttons)} (must all be 0); ` +
        `flat-fast / adaptive-fast / adaptive-slow: ${MOVES.map((n) => btnText(ph(k)[n] && ph(k)[n].buttons)).join(' / ')} (must all be 0)`);
    }
    // The same phases on the plain lock (switch off): the control, informational.
    {
      const h = ph('off').held; const nb = ph('off').none;
      say(`c51    INFO  switch off (plain lock, the control): left button held: ${btnText(h && h.buttons)}; after the release: ${btnText(h && h.afterRelease)}; no button held: ${btnText(nb && nb.buttons)}`);
    }
    const apr = (k) => ph(k)['after-plain-request'];
    verdict('c12', clean(R['c51+c12']) && exact(apr('c51+c12')),
      `on X11 with c51: after requestPointerLock() without options on a raw lock: c51 alone ${apr('c51') ? `(${apr('c51').stats.mx},${apr('c51').stats.my})` : 'n/a'} (downgraded to accelerated movement), ` +
      `with KccPinRawPointerLock ${apr('c51+c12') ? `(${apr('c51+c12').stats.mx},${apr('c51+c12').stats.my})` : 'n/a'} (must stay raw: 200,120)`);
    const ff = (k) => (ph(k)['flat-fast'] || {}).stats || {};
    verdict('c15', clean(R['c51+c15']) && ff('c51+c15').maxCoalesced === 1 && ff('c51+c15').maxPredicted === 0 && ff('c51+c15').coalescedSumX === 200 && exact(ph('c51+c15')['flat-fast']),
      `on X11 with c51: raw pointermoves: c51 alone coalesced up to ${ff('c51').maxCoalesced}, predicted up to ${ff('c51').maxPredicted}; with KccLeanLockedMouseMove ${ff('c51+c15').maxCoalesced} and ${ff('c51+c15').maxPredicted} (must be 1 and 0), coalesced entries sum ${ff('c51+c15').coalescedSumX} (must be 200)`);
  }
}

say(`\n${allPass ? 'SYNTHETIC CHECKS: PASS' : 'SYNTHETIC CHECKS: SOME FAILED (see above)'}`);
process.exit(allPass ? 0 : 1);
