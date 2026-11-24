// Frame-cap release gate driver for Linux (test/frame-cap-test.js), the
// counterpart of run-frame-cap-gate.ps1 with the same suites, rules and
// re-run rule.
//
//   node linux-run-frame-cap-gate.js --exe <electron> --out <dir>
//       [--variants off,all] [--busy 5,3] [--heavy-runs 5] [--parts A,B]
//       [--heavy-mode webgl|2d] [--features-via commandline|js] [--window-ms N]
//
// Part A, for every variant: the launch suite for CustomFrameCap:fps/60, /144
// and /240 (2D page), and the runtime suite (setFrameCap 60/144/240, hide/show,
// resize, change at once, setFrameCap(0), a second animating view) with a 2D
// and with a WebGL2 page.
// Part B: the heavy suite (a page that spins --busy ms per frame, so caps of
// 1000 and 240 are above its reach), --heavy-runs times per busy value, the
// variants interleaved with "off" in every round; for each cap the best run of
// a variant must not be more than 3 % below the best run of "off" (a cap above
// reach must not lose rate). Medians and every run are reported as well.
// Variants: off (no KCC switch), all (every switch of the series + --js-flags).
// The "precise" variant (c60, KccFrameCapPreciseRelease) is Windows-only.
// Never combined with CustomMaxPendingFrames:count/2 (a documented conflict).
//
// --features-via js passes the --enable-features list as --kcc-features, which
// frame-cap-test.js appends from the main script: needed on a DCHECK build,
// where field-trial parameters on the command line stop stock Electron at
// startup (see frame-cap-test.js).
//
// Re-runs: a run whose only failures are rate checks (exit 1 with a result, no
// freeze, no crash) is run once more and both attempts are reported; a second
// miss is a fail. A crash, a DCHECK, a harness error, a frozen window, a run
// with no frames or a missing result file is never re-run.
'use strict';
const fs = require('fs');
const path = require('path');
const c = require('./linux-common');

const o = c.parseArgs(process.argv.slice(2), {
  exe: '', out: '', variants: 'off', busy: '5,3', 'heavy-runs': '5', parts: 'A,B',
  'heavy-mode': 'webgl', 'features-via': 'commandline', 'window-ms': '0',
});
const variants = c.list(o.variants);
const busyList = c.list(o.parts).includes('B') ? c.list(o.busy) : [];
const heavyRuns = parseInt(o['heavy-runs'], 10);
const windowMs = parseInt(o['window-ms'], 10);
if (!o.exe || !o.out || variants.some((v) => !['off', 'all'].includes(v))) {
  console.error('usage: node linux-run-frame-cap-gate.js --exe <electron> --out <dir> [--variants off,all] ...');
  process.exit(2);
}
const say = c.summaryWriter(path.join(o.out, `summary-${variants.join('-')}.txt`),
  `frame-cap gate  ${c.stamp()}\nexe: ${o.exe}\nvariants: ${variants.join(',')}  parts: ${o.parts}  heavy suite: ${o['heavy-mode']} page, ` +
  `busy ${busyList.join(', ')} ms, ${heavyRuns} runs each  features via: ${o['features-via']}\nplatform args: ${c.PLATFORM_ARGS.join(' ')}  DISPLAY=${process.env.DISPLAY || ''}\n`);

const variantFeatures = (v) => (v === 'all' ? c.KCC_ALL_FEATURES : []);
const variantJs = (v) => (v === 'all' ? [`--js-flags=${c.KCC_ALL_JS_FLAGS}`] : []);
function featureArgs(features) {
  const a = c.joinFeatures(features);
  return o['features-via'] === 'js' ? a.map((s) => s.replace(/^--enable-features=/, '--kcc-features=')) : a;
}

// One suite run, re-run once when only rate checks failed. Returns the attempts.
function runSuite(name, argv) {
  const json = path.join(o.out, `${name}.json`);
  const log = path.join(o.out, `${name}.log`);
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      const j1 = path.join(o.out, `${name}-try1.json`); const l1 = path.join(o.out, `${name}-try1.log`);
      fs.renameSync(json, j1); fs.renameSync(log, l1);
      attempts[0].json = j1; attempts[0].log = l1;
    }
    fs.rmSync(json, { force: true });
    const wm = windowMs > 0 ? [`--kcc-window-ms=${windowMs}`] : [];
    const code = c.runElectron(o.exe, [...argv, ...wm, `--kcc-out=${json}`, '--enable-logging'], log);
    const res = c.readJson(json);
    const crash = c.crashLines(log);
    const froze = Boolean(res && (res.measurements || []).some((m) => m.error));
    // frame-cap.html falls back to a 2D canvas when WebGL2 is unavailable; a
    // WebGL suite that drew in 2D did not test what it is for.
    const noWebgl = argv.includes('--kcc-mode=webgl') && res && res.pageRenderer && res.pageRenderer !== 'webgl2';
    attempts.push({ attempt, code, res, crash, froze, noWebgl, json, log });
    const retry = code === 1 && res && !froze && !noWebgl && crash.length === 0;
    if (!retry) break;
  }
  return attempts;
}

// Summary lines for one suite; returns whether it passed: the last attempt
// passed and no attempt crashed.
function writeSuite(name, attempts) {
  for (const a of attempts) {
    const tag = attempts.length > 1 ? `${name} (attempt ${a.attempt})` : name;
    let line = `${tag.padEnd(30)} exit ${a.code}`;
    if (a.res) {
      const checks = a.res.checks || [];
      const failed = checks.filter((k) => !k.pass);
      line += `  checks ${checks.length - failed.length}/${checks.length}`;
      if (a.res.suite === 'heavy') line += `  (busy ${a.res.busy} ms: reach ${c.fmt1(a.res.reach)}, cap1000 ${c.fmt1(a.res.cap1000)}, cap240 ${c.fmt1(a.res.cap240)}, cap144 ${c.fmt1(a.res.cap144)})`;
      if (a.res.suite === 'runtime') line += `  (uncapped baseline ${c.fmt1(a.res.uncappedBaseline)} fps, page ${a.res.pageRenderer})`;
      for (const f of failed) line += `\n    FAIL ${f.name}: ${f.detail}`;
      for (const s of a.res.skipped || []) if (s) line += `\n    SKIP ${s.name}: ${s.why}`;
      if (a.froze) line += '\n    FROZE: a measurement timed out';
      if (a.noWebgl) line += `\n    FAIL page renderer: ${a.res.pageRenderer} (WebGL2 unavailable: the WebGL suite drew on a 2D canvas)`;
    } else line += '  NO RESULT FILE';
    for (const l of a.crash) line += `\n    LOG: ${l}`;
    say(line);
  }
  const crashes = attempts.filter((a) => a.crash.length > 0).length;
  const last = attempts[attempts.length - 1];
  return last.code === 0 && crashes === 0 && !last.noWebgl;
}

let allPass = true;

// ---- part A: launch and runtime suites ----------------------------------------
if (c.list(o.parts).includes('A')) {
  for (const v of variants) {
    const vf = variantFeatures(v);
    const runs = [];
    for (const n of [60, 144, 240]) {
      runs.push([`launch-${n}`, ['frame-cap-test.js', '--kcc-suite=launch', `--kcc-cap=${n}`, '--kcc-mode=2d', ...featureArgs([`CustomFrameCap:fps/${n}`, ...vf])]]);
    }
    runs.push(['runtime-2d', ['frame-cap-test.js', '--kcc-suite=runtime', '--kcc-mode=2d', ...featureArgs(vf)]]);
    runs.push(['runtime-webgl', ['frame-cap-test.js', '--kcc-suite=runtime', '--kcc-mode=webgl', ...featureArgs(vf)]]);
    for (const [suite, argv] of runs) {
      const name = `${v}-${suite}`;
      if (!writeSuite(name, runSuite(name, [...argv, ...variantJs(v)]))) allPass = false;
    }
  }
}

// ---- part B: heavy suite, variants interleaved with "off" ---------------------
const heavyVariants = ['off', ...variants.filter((v) => v !== 'off')];
const heavy = {};
for (const b of busyList) {
  for (let i = 1; i <= heavyRuns; i++) {
    for (const v of heavyVariants) {
      const name = `${v}-heavy-${b}-${i}`;
      const att = runSuite(name, ['frame-cap-test.js', '--kcc-suite=heavy', `--kcc-busy=${b}`, `--kcc-mode=${o['heavy-mode']}`, ...featureArgs(variantFeatures(v)), ...variantJs(v)]);
      if (!writeSuite(name, att)) allPass = false;
      const last = att[att.length - 1];
      if (last.res && last.code === 0) (heavy[`${v}|${b}`] = heavy[`${v}|${b}`] || []).push(last.res);
    }
  }
}
const KEYS = ['reach', 'cap1000', 'cap240', 'cap144'];
const best = (rs, k) => Math.max(...rs.map((r) => Number(r[k])));
for (const b of busyList) {
  const base = heavy[`off|${b}`];
  if (!base) { say(`\nheavy suite, busy ${b} ms: no passing run of variant off`); allPass = false; continue; }
  say(`\nheavy suite, busy ${b} ms, ${heavyRuns} runs per variant: best / median [each run]`);
  for (const v of heavyVariants) {
    const rs = heavy[`${v}|${b}`];
    if (!rs) { say(`  ${v}: no passing run`); if (v !== 'off') allPass = false; continue; }
    say(`  ${v.padEnd(8)} ${KEYS.map((k) => `${k} ${c.fmt1(best(rs, k))} / ${c.fmt1(c.median(rs.map((r) => Number(r[k]))))} [${rs.map((r) => c.fmt1(Number(r[k]))).join(' / ')}]`).join('  ')}`);
  }
  for (const v of heavyVariants.filter((x) => x !== 'off')) {
    const rs = heavy[`${v}|${b}`];
    if (!rs) continue;
    for (const k of ['cap1000', 'cap240', 'cap144']) {
      const bv = best(rs, k); const bo = best(base, k);
      const ratio = bv / bo;
      const ok = ratio >= 0.97;
      if (!ok) allPass = false;
      const mratio = c.median(rs.map((r) => Number(r[k]))) / c.median(base.map((r) => Number(r[k])));
      const pct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
      say(`  ${`${v}|${b}`.padEnd(12)} ${k.padEnd(8)} best ${c.fmt1(bv).padStart(7)} vs off ${c.fmt1(bo).padStart(7)}  (${pct((ratio - 1) * 100)} %; medians ${pct((mratio - 1) * 100)} %)  ${ok ? 'ok' : 'DROP'}`);
    }
  }
}
say(`\nFRAME-CAP GATE: ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
