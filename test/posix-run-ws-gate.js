// WebSocket-starvation release gate driver for macOS and Linux: the Node port of
// run-ws-gate.ps1, with the same runs, pass rules and re-run rule. Runs the 12 s
// CDP stress test (cdp-test.js) --runs times and passes when every run has 0 %
// of messages over 50 ms, a p99 below 50 ms, and rendered frames (a run with no
// rAF frames is inconclusive, not a pass).
//
//   node posix-run-ws-gate.js --exe <electron> --out <dir> [--flags off|on] [--runs 2]
//
// Prerequisite: `npm ci` in test/ (cdp-test.js needs the `ws` package).
//
// --flags on adds every switch of the series (README "Everything on").
//
// Re-runs: a run that exited cleanly with frames but missed only the latency
// limits is run once more, and both attempts are reported; a second miss is a
// fail. A crash or a DCHECK is never re-run.
//
// Invalid runs (macOS): every launch waits until the display is awake and the
// screen unlocked. A run that rendered no frames, or after which the display was
// asleep or locked, is INVALID: reported, not counted, and run again (up to 3
// attempts). A run without a valid attempt leaves the gate INCOMPLETE, not
// passed; if it rendered no frames with the display awake and unlocked, the
// summary says so, as that is a finding rather than a test-environment problem.
'use strict';
const fs = require('fs');
const path = require('path');
const k = require('./posix-kcc-flags');

async function main(argv) {
  const a = k.parseArgs(argv, { flags: 'off', runs: '2' });
  if (!a.exe || !a.out || !['off', 'on'].includes(a.flags)) {
    console.log('usage: node posix-run-ws-gate.js --exe <electron> --out <dir> [--flags off|on] [--runs 2]');
    return 2;
  }
  k.keepAwake();
  fs.mkdirSync(a.out, { recursive: true });
  const say = k.makeSummary(path.join(a.out, `ws-gate-${a.flags}.txt`),
    `WS starvation gate  flags ${a.flags}  ${k.stamp()}\nexe: ${a.exe}\n${k.machineNotes()}\n`);
  const extra = a.flags === 'on' ? k.joinKccFeatures(k.KCC_ALL_FEATURES) : [];
  let failed = false;
  let incomplete = false;
  for (let i = 1; i <= Number(a.runs); i++) {
    const label = `WS-${a.flags}-${i}`;
    const log = path.join(a.out, `ws-gate-${a.flags}-${i}.log`);
    let outcome = null;  // 'pass' | 'fail' | 'invalid'
    let latencyMisses = 0;
    let invalid = 0;
    let framelessAwake = 0;
    for (let attempt = 1; outcome === null; attempt++) {
      if (attempt > 1) fs.renameSync(log, path.join(a.out, `ws-gate-${a.flags}-${i}-try${attempt - 1}.log`));
      const code = await k.invokeElectron(a.exe, ['cdp-test.js', String(8090 + i), label, '--enable-logging', ...extra], log, { note: say });
      const text = fs.readFileSync(log, 'utf8');
      const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
      const p99 = num(/\]\s+p99:\s+([\d.]+)/);
      const over = num(/>50ms:\s+(\d+) \/ \d+/);
      const total = num(/>50ms:\s+\d+ \/ (\d+)/);
      const max = num(/\]\s+max:\s+([\d.]+)/);
      const frames = num(/RAF frames rendered: (-?\d+)/);
      const crash = k.crashLines(log);
      const tag = attempt > 1 ? `${label} (attempt ${attempt})` : label;
      let line = `${tag.padEnd(22)} exit ${code}  p99 ${p99} ms  max ${max} ms  >50ms ${over}/${total}  rAF frames ${frames}  `;
      const why = crash.length ? null : (k.displayInvalid() || (frames > 0 ? null : 'no rAF frames rendered'));
      if (why) {
        if (!k.displayInvalid()) framelessAwake++;
        line += `INVALID (${why}; display ${k.displayDesc(k.lastRunDisplay().after)}) - not counted`;
        if (++invalid >= 3) outcome = 'invalid';
      } else {
        const clean = code === 0 && p99 !== null && crash.length === 0;
        const pass = clean && p99 < 50 && over === 0;
        line += pass ? 'PASS' : 'FAIL';
        if (pass) outcome = 'pass';
        else if (!clean || ++latencyMisses >= 2) outcome = 'fail';
      }
      for (const c of crash) line += `\n    LOG: ${c}`;
      say(line);
    }
    if (outcome === 'fail') failed = true;
    if (outcome === 'invalid') {
      incomplete = true;
      say(`${label}: no valid attempt in ${invalid}` +
        (framelessAwake ? `; ${framelessAwake} of them rendered no frames with the display awake and unlocked (a finding: see the logs)` : ''));
    }
  }
  const verdict = failed ? 'FAIL' : incomplete ? 'INCOMPLETE' : 'PASS';
  say(`WS GATE (${a.flags}): ${verdict}`);
  return verdict === 'PASS' ? 0 : 1;
}

if (require.main === module) k.runMain(main);
module.exports = { main };
