// Runs mac-raw-input-test.js (the macOS check of c12 and c15 with injected
// mouse moves) for several switch variants and compares the results with what
// each switch should change. Plain Node, from any directory:
//
//   node test/mac-run-raw-input.js --exe <out>/Electron.app/Contents/MacOS/Electron
//       --out <dir> --injector <dir>/KccMouseInject.app
//       [--variants off,c12,c15,c12+c15,all] [--runs 3] [--tap hid]
//
// KccMouseInject.app (mac-build-mouse-inject.sh) needs the Accessibility
// permission. Each phase injects 40 moves, every one with accelerated
// (+11, +7) and unaccelerated (+5, +3) movement (see mac-raw-input-test.js).
//
// Each injection starts with 3 lead-in moves of (+1, +1); the page records
// every locked mousemove, and sums and counts below are of the measured moves
// only. A run counts (is valid) only when, in each of the three phases with
// moves 20 ms apart, all 40 measured moves reached the page: then none was
// merged or lost, and the sums can be compared. Expected in a valid run:
//   adjusted-lock        (440, 280) in every variant: the adjusted path.
//   raw-move             (200, 120) in every variant: the raw path.
//   after-plain-request  without c12 (440, 280): the held raw lock was
//                        downgraded. With c12 (200, 120): still raw.
//   raw-burst            moves 2 ms apart, which macOS merges. With c15 lean
//                        (coalesced lists of 1, no predicted events); without
//                        it, predicted events.
//   raw-burst-busy       the same with the main thread busy: with c15 lean;
//                        without it, coalesced lists of more than 1.
// The bursts are judged on that shape, not on sums. Their summary columns show
// how many events reached the page per 40 injected (the merge rate of the run).
// In every phase the pointermove sums equal the mousemove sums, and the
// coalesced entries add up to the pointermove sum.
//
// A run that another app interrupts (it took the focus) or in which a 20 ms
// phase did not deliver exactly 40 moves is reported as INVALID and repeated,
// up to 3 attempts per run. After 3 invalid attempts in a row the driver stops.
// Every attempt is in the summary.
// Exit code: 0 every valid run as expected, 1 a valid run was not, 2 harness
// error or stopped.
'use strict';
const fs = require('fs');
const path = require('path');
const k = require('./posix-kcc-flags.js');

const C12 = 'KccPinRawPointerLock';
const C15 = 'KccLeanLockedMouseMove';
const VARIANTS = {
  off: [],
  c12: [C12],
  c15: [C15],
  'c12+c15': [C12, C15],
  all: k.KCC_ALL_FEATURES,
};
const RAW = [200, 120];
const ADJ = [440, 280];
const MOVES = 40;
const SLOW_PHASES = ['adjusted-lock', 'raw-move', 'after-plain-request'];
const PHASES = ['adjusted-lock', 'raw-move', 'raw-burst', 'raw-burst-busy', 'after-plain-request'];
const ATTEMPTS = 3;

// Why a finished run does not count, or null.
function runNotValid(r) {
  if (!r) return null;
  if (r.interrupted) return `interrupted: ${r.interrupted}`;
  for (const n of SLOW_PHASES) {
    const p = r.phases && r.phases[n];
    if (p && p.measured.n !== MOVES) return `${n}: ${p.measured.n} of ${MOVES} measured moves reached the page`;
  }
  return null;
}

// What a valid run should show, given its switches. Returns a list of misses.
function check(r, feats) {
  const c12 = feats.includes(C12);
  const c15 = feats.includes(C15);
  const miss = [];
  const stats = (n) => (r.phases && r.phases[n] ? r.phases[n].stats : null);
  for (const n of PHASES) {
    const s = stats(n);
    if (!s) { miss.push(`${n}: did not run`); continue; }
    if (s.px !== s.mx || s.py !== s.my) miss.push(`${n}: pointermove (${s.px},${s.py}) != mousemove (${s.mx},${s.my})`);
    if (s.coalescedSumX !== s.px) miss.push(`${n}: coalesced entries sum to ${s.coalescedSumX}, pointermoves to ${s.px}`);
  }
  const sums = (n, want) => {
    const m = r.phases && r.phases[n] ? r.phases[n].measured : null;
    if (m && (m.mx !== want[0] || m.my !== want[1])) miss.push(`${n}: movement (${m.mx},${m.my}) instead of (${want})`);
  };
  sums('adjusted-lock', ADJ);
  sums('raw-move', RAW);
  sums('after-plain-request', c12 ? RAW : ADJ);
  // shape: 'lean' (coalesced 1, predicted 0), 'predicted' (some predicted
  // events) or 'coalesced' (lists of more than 1).
  const shape = (n, want) => {
    const s = stats(n);
    if (!s) return;
    if (want === 'lean' && (s.maxCoalesced !== 1 || s.maxPredicted !== 0)) {
      miss.push(`${n}: coalesced up to ${s.maxCoalesced}, predicted up to ${s.maxPredicted} (lean expected: 1 and 0)`);
    }
    if (want === 'predicted' && s.maxPredicted < 1) miss.push(`${n}: no predicted events (expected some)`);
    if (want === 'coalesced' && s.maxCoalesced <= 1) miss.push(`${n}: coalesced lists of ${s.maxCoalesced} (more than 1 expected)`);
  };
  shape('raw-burst', c15 ? 'lean' : 'predicted');
  shape('raw-burst-busy', c15 ? 'lean' : 'coalesced');
  for (const p of r.problems || []) miss.push(p);
  for (const e of r.events || []) miss.push(e);
  return miss;
}

// "(200,120) n=40/40 lead 2/3" for the sum phases; "(50,30) n=10/40 lead 3/3
// c<=1 p<=3" for the bursts. Sums and n are the measured moves'; c and p the
// page's (largest coalesced list, most predicted events of one pointermove).
function phaseText(r, name) {
  const p = r && r.phases && r.phases[name];
  if (!p) return '-';
  const m = p.measured;
  const s = p.stats;
  const base = `(${m.mx},${m.my}) n=${m.n}/${MOVES} lead ${m.leadSeen}/3`;
  return SLOW_PHASES.includes(name) ? base : `${base} c<=${s.maxCoalesced} p<=${s.maxPredicted}`;
}

async function main(argv) {
  const o = k.parseArgs(argv, { variants: 'off,c12,c15,c12+c15,all', runs: '3', tap: 'hid' });
  if (!o.exe || !o.out || !o.injector) throw new Error('--exe, --out and --injector are required');
  const variants = k.list(o.variants);
  for (const v of variants) if (!VARIANTS[v]) throw new Error(`unknown variant ${v}`);
  const runs = Number(o.runs);
  fs.mkdirSync(o.out, { recursive: true });
  const say = k.makeSummary(path.join(o.out, 'summary.txt'),
    `# mac-run-raw-input ${k.stamp()}\n# exe ${o.exe}\n# tap ${o.tap}, ${runs} run(s) per variant; ` +
    'per phase: movement sums, mousemoves at the page n / injected, and for the bursts the largest coalesced list c ' +
    'and the most predicted events p');
  k.keepAwake();
  let failed = 0;
  let invalidInARow = 0;
  for (let run = 1; run <= runs; run++) {
    for (const v of variants) {
      const feats = VARIANTS[v];
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        const base = path.join(o.out, `${v}-${run}${attempt > 1 ? `-attempt${attempt}` : ''}`);
        const json = `${base}.json`;
        try { fs.unlinkSync(json); } catch { /* none yet */ }
        const code = await k.invokeElectron(o.exe, ['mac-raw-input-test.js', `--kcc-out=${json}`,
          `--kcc-injector=${o.injector}`, `--kcc-tap=${o.tap}`, ...k.joinKccFeatures(feats)], `${base}.log`);
        const r = k.readJson(json);
        const invalid = k.runInvalid() || runNotValid(r);
        const crashes = k.crashLines(`${base}.log`);
        const miss = invalid ? [] : r ? check(r, feats) : [`no result (exit ${code})`];
        for (const c of crashes) miss.push(`log: ${c}`);
        const verdict = invalid && !crashes.length ? `INVALID (${invalid})` : miss.length ? 'FAIL' : 'ok';
        say(`${v.padEnd(8)} run ${run}${attempt > 1 ? ` attempt ${attempt}` : ''}  exit ${code}` +
          PHASES.map((n) => `  ${n} ${phaseText(r, n)}`).join(' |') + `  ${verdict}`);
        for (const m of miss) say(`    ${m}`);
        if (!invalid || crashes.length) {
          invalidInARow = 0;
          if (miss.length) failed++;
          break;
        }
        if (++invalidInARow >= ATTEMPTS) {
          say(`STOPPED: ${ATTEMPTS} invalid attempts in a row`);
          return 2;
        }
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  }
  say(failed ? `RESULT: ${failed} valid run(s) not as expected` : 'RESULT: every valid run as expected');
  return failed ? 1 : 0;
}

k.runMain(main);
