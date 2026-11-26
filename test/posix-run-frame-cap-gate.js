// Frame-cap release gate driver for macOS and Linux: the Node port of
// run-frame-cap-gate.ps1, with the same suites, pass rules and re-run rule.
//
//   node posix-run-frame-cap-gate.js --exe <electron> --out <dir>
//       [--variants off,all] [--busy 5,3] [--heavy-runs 5] [--parts A,B]
//       [--heavy-mode webgl|2d] [--features-via commandline|js] [--window-ms N]
//
// Part A, for every variant: the launch suite for CustomFrameCap:fps/60, /144 and
// /240 (2D page), and the runtime suite (setFrameCap 60/144/240, hide/show,
// resize, change at once, setFrameCap(0), a second animating view) with a 2D and
// with a WebGL2 page.
// Part B: the heavy suite (a page that spins --busy ms per frame, so caps of 1000
// and 240 are above its reach), --heavy-runs times per busy value, the variants
// interleaved with variant "off" in every round; for each cap the best run of a
// variant must not be more than 3 % below the best run of "off" (a cap above
// reach must not lose rate). Medians and every run are reported as well.
// Variants:
//   off      no KCC switch
//   all      every switch of the series (README "Everything on")
//   precise  KccFrameCapPreciseRelease (c60, Windows only: on macOS and Linux the
//            feature does not exist, so this is variant "off" under another name)
// Never combined with CustomMaxPendingFrames:count/2 (a documented conflict).
//
// --features-via js passes the --enable-features list as --kcc-features, which
// frame-cap-test.js appends from the main script. Needed on a DCHECK build:
// there, field-trial parameters on the command line (CustomFrameCap:fps/N) stop
// stock Electron at startup (see frame-cap-test.js).
//
// Re-runs: a run whose only failures are rate checks is run once more and both
// attempts are reported; a second miss is a fail. A crash, a DCHECK, a harness
// error, a frozen window (a measurement that timed out) or a missing result file
// is never re-run. The summary is summary-<variants>.txt.
//
// Invalid runs (macOS): every launch waits until the display is awake and the
// screen unlocked. A run after which the display was asleep or locked, or whose
// measurements all counted no frames, is INVALID: reported, not counted, and run
// again (up to 3 attempts); a suite without a valid attempt leaves the gate
// INCOMPLETE, not passed.
//
// Uncapped figures: each launch line shows the page's uncapped rate in the same
// run (setFrameCap(0) after the launch cap), each runtime line its uncapped
// baseline, and each heavy line its reach (uncapped), next to the capped rates.
'use strict';
const fs = require('fs');
const path = require('path');
const k = require('./posix-kcc-flags');

function variantFeatures(v) {
  switch (v) {
    case 'off': return [];
    case 'precise': return ['KccFrameCapPreciseRelease'];
    case 'all': return k.KCC_ALL_FEATURES;
    default: throw new Error(`unknown variant ${v}`);
  }
}

const median = (xs) => {
  const s = xs.map(Number).sort((p, q) => p - q);
  if (s.length === 0) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pct = (ratio) => { const x = (ratio - 1) * 100; return `${x >= 0 ? '+' : ''}${x.toFixed(1)}`; };

async function main(argv) {
  const a = k.parseArgs(argv, {
    variants: 'off', busy: '5,3', 'heavy-runs': '5', parts: 'A,B',
    'heavy-mode': 'webgl', 'features-via': 'commandline', 'window-ms': '0',
  });
  if (!a.exe || !a.out) {
    console.log('usage: node posix-run-frame-cap-gate.js --exe <electron> --out <dir> [--variants off,all] [--busy 5,3] [--heavy-runs 5] [--parts A,B] [--heavy-mode webgl|2d] [--features-via commandline|js]');
    return 2;
  }
  const variants = k.list(a.variants);
  const busy = k.list(a.busy);
  const parts = k.list(a.parts);
  const heavyRuns = Number(a['heavy-runs']);
  variants.forEach(variantFeatures);  // throws on an unknown name before anything runs
  k.keepAwake();
  fs.mkdirSync(a.out, { recursive: true });
  const say = k.makeSummary(path.join(a.out, `summary-${variants.join('-')}.txt`),
    `frame-cap gate  ${k.stamp()}\nexe: ${a.exe}\nvariants: ${variants.join(',')}  parts: ${parts.join(',')}  ` +
    `heavy suite: ${a['heavy-mode']} page, busy ${busy.join(', ')} ms, ${heavyRuns} runs each  features via: ${a['features-via']}\n` +
    `${k.machineNotes()}\n`);
  const featureArgs = (features) => {
    const r = k.joinKccFeatures(features);
    return a['features-via'] === 'js' ? r.map((s) => s.replace(/^--enable-features=/, '--kcc-features=')) : r;
  };

  // One suite run, re-run once when only rate checks failed, and re-run (up to 3
  // attempts) while a run is invalid. Returns the attempts.
  async function invokeSuite(name, args) {
    const json = path.join(a.out, `${name}.json`);
    const log = path.join(a.out, `${name}.log`);
    const attempts = [];
    let rateRetries = 0;
    let invalid = 0;
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) {
        // Keep the earlier attempts next to the latest.
        const prev = attempts[attempts.length - 1];
        const jp = path.join(a.out, `${name}-try${attempt - 1}.json`);
        const lp = path.join(a.out, `${name}-try${attempt - 1}.log`);
        if (fs.existsSync(json)) fs.renameSync(json, jp);
        fs.renameSync(log, lp);
        prev.json = jp;
        prev.log = lp;
      }
      fs.rmSync(json, { force: true });
      const wm = Number(a['window-ms']) > 0 ? [`--kcc-window-ms=${a['window-ms']}`] : [];
      const code = await k.invokeElectron(a.exe, [...args, ...wm, `--kcc-out=${json}`, '--enable-logging'], log, { note: say });
      const res = k.readJson(json);
      const crash = k.crashLines(log);
      const froze = !!(res && (res.measurements || []).some((m) => m && m.error));
      const ms = (res && res.measurements) || [];
      const frameless = ms.length > 0 && ms.every((m) => !(m && m.frames > 0));
      const why = crash.length ? null : (k.displayInvalid() || (frameless ? 'no measurement counted a frame' : null));
      attempts.push({ attempt, code, res, crash, froze, json, log, invalid: why, display: k.lastRunDisplay().after });
      if (why) {
        if (++invalid >= 3) break;
        continue;
      }
      const retry = code === 1 && res && !froze && crash.length === 0 && rateRetries === 0;
      if (!retry) break;
      rateRetries++;
    }
    return attempts;
  }

  // The page's uncapped rate in a launch run and its rate at the launch cap.
  const launchFigures = (res) => {
    const ms = res.measurements || [];
    const capped = ms.find((m) => m.name === `launch ${res.cap}`);
    const un = ms.find((m) => m.name === 'setFrameCap(0) after launch cap');
    return `(launch cap ${res.cap}: ${capped && !capped.error ? k.r1(capped.fps) : 'n/a'} fps; uncapped ${un && !un.error ? k.r1(un.fps) : 'n/a'} fps; page ${res.pageRenderer})`;
  };

  // Summary lines for one suite; returns its verdict: 'pass' (the last attempt is
  // valid and passed, no attempt crashed), 'invalid' (no valid attempt) or 'fail'.
  function writeSuite(name, attempts) {
    for (const t of attempts) {
      const tag = attempts.length > 1 ? `${name} (attempt ${t.attempt})` : name;
      let line = `${tag.padEnd(30)} exit ${t.code}`;
      if (t.res) {
        const checks = t.res.checks || [];
        const failed = checks.filter((c) => !c.pass);
        line += `  checks ${checks.length - failed.length}/${checks.length}`;
        if (t.res.suite === 'heavy') {
          line += `  (busy ${t.res.busy} ms: reach ${k.r1(t.res.reach)}, cap1000 ${k.r1(t.res.cap1000)}, cap240 ${k.r1(t.res.cap240)}, cap144 ${k.r1(t.res.cap144)})`;
        }
        if (t.res.suite === 'runtime') line += `  (uncapped baseline ${k.r1(t.res.uncappedBaseline)} fps, page ${t.res.pageRenderer})`;
        if (t.res.suite === 'launch') line += `  ${launchFigures(t.res)}`;
        if (t.invalid) line += `\n    INVALID (${t.invalid}; display ${k.displayDesc(t.display)}) - not counted`;
        for (const f of failed) line += `\n    FAIL ${f.name}: ${f.detail}`;
        for (const s of t.res.skipped || []) if (s) line += `\n    SKIP ${s.name}: ${s.why}`;
        if (t.froze) line += '\n    FROZE: a measurement timed out';
      } else {
        line += '  NO RESULT FILE';
        if (t.invalid) line += `\n    INVALID (${t.invalid}; display ${k.displayDesc(t.display)}) - not counted`;
      }
      for (const c of t.crash) line += `\n    LOG: ${c}`;
      say(line);
    }
    const last = attempts[attempts.length - 1];
    if (attempts.some((t) => t.crash.length > 0)) return 'fail';
    if (last.invalid) return 'invalid';
    return last.code === 0 ? 'pass' : 'fail';
  }

  let allPass = true;
  let incomplete = false;
  const verdictOf = (v) => {
    if (v === 'fail') allPass = false;
    if (v === 'invalid') incomplete = true;
    return v;
  };

  // ---- part A: launch and runtime suites -------------------------------------
  if (parts.includes('A')) {
    for (const v of variants) {
      const vf = variantFeatures(v);
      // Launch caps and the first runtime suite draw with a 2D canvas; the second
      // runtime suite and the heavy suite draw with WebGL2, the game's path.
      const runs = [];
      for (const n of [60, 144, 240]) {
        runs.push([`launch-${n}`, ['frame-cap-test.js', '--kcc-suite=launch', `--kcc-cap=${n}`, '--kcc-mode=2d', ...featureArgs([`CustomFrameCap:fps/${n}`, ...vf])]]);
      }
      runs.push(['runtime-2d', ['frame-cap-test.js', '--kcc-suite=runtime', '--kcc-mode=2d', ...featureArgs(vf)]]);
      runs.push(['runtime-webgl', ['frame-cap-test.js', '--kcc-suite=runtime', '--kcc-mode=webgl', ...featureArgs(vf)]]);
      for (const [n, args] of runs) {
        const name = `${v}-${n}`;
        verdictOf(writeSuite(name, await invokeSuite(name, args)));
      }
    }
  }

  // ---- part B: heavy suite, variants interleaved with "off" ------------------
  const heavyVariants = ['off', ...variants.filter((v) => v !== 'off')];
  const heavy = {};
  const heavyInvalid = {};
  const busyList = parts.includes('B') ? busy : [];
  // No valid run for a variant: incomplete when its runs were invalid, else a fail.
  const noRun = (key) => { if (heavyInvalid[key]) incomplete = true; else allPass = false; };
  for (const b of busyList) {
    for (let i = 1; i <= heavyRuns; i++) {
      for (const v of heavyVariants) {
        const name = `${v}-heavy-${b}-${i}`;
        const att = await invokeSuite(name, ['frame-cap-test.js', '--kcc-suite=heavy', `--kcc-busy=${b}`, `--kcc-mode=${a['heavy-mode']}`, ...featureArgs(variantFeatures(v))]);
        if (verdictOf(writeSuite(name, att)) === 'invalid') heavyInvalid[`${v}|${b}`] = (heavyInvalid[`${v}|${b}`] || 0) + 1;
        const last = att[att.length - 1];
        if (last.res && last.code === 0 && !last.invalid) (heavy[`${v}|${b}`] = heavy[`${v}|${b}`] || []).push(last.res);
      }
    }
  }
  const best = (rs, key) => Math.max(...rs.map((r) => Number(r[key])));
  const each = (rs, key) => rs.map((r) => k.r1(r[key])).join(' / ');
  for (const b of busyList) {
    const base = heavy[`off|${b}`];
    if (!base) { say(`\nheavy suite, busy ${b} ms: no passing valid run of variant off`); noRun(`off|${b}`); continue; }
    say(`\nheavy suite, busy ${b} ms, ${heavyRuns} runs per variant: best / median [each run]`);
    for (const v of heavyVariants) {
      const rs = heavy[`${v}|${b}`];
      if (!rs) { say(`  ${v}: no passing valid run`); if (v !== 'off') noRun(`${v}|${b}`); continue; }
      const cells = ['reach', 'cap1000', 'cap240', 'cap144'].map((key) =>
        `${key} ${best(rs, key).toFixed(1)} / ${median(rs.map((r) => r[key])).toFixed(1)} [${each(rs, key)}]`);
      say(`  ${v.padEnd(8)} ${cells.join('  ')}`);
    }
    for (const v of heavyVariants.filter((x) => x !== 'off')) {
      const rs = heavy[`${v}|${b}`];
      if (!rs) continue;
      for (const key of ['cap1000', 'cap240', 'cap144']) {
        const bv = best(rs, key);
        const bo = best(base, key);
        const ratio = bv / bo;
        const ok = ratio >= 0.97;
        if (!ok) allPass = false;
        const mratio = median(rs.map((r) => r[key])) / median(base.map((r) => r[key]));
        say(`  ${`${v}|${b}`.padEnd(12)} ${key.padEnd(8)} best ${bv.toFixed(1).padStart(7)} vs off ${bo.toFixed(1).padStart(7)}  (${pct(ratio)} %; medians ${pct(mratio)} %)  ${ok ? 'ok' : 'DROP'}`);
      }
    }
  }
  const verdict = !allPass ? 'FAIL' : incomplete ? 'INCOMPLETE' : 'PASS';
  say(`\nFRAME-CAP GATE: ${verdict}`);
  return verdict === 'PASS' ? 0 : 1;
}

if (require.main === module) k.runMain(main);
module.exports = { main };
