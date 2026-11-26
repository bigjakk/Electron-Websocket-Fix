// WebSocket-starvation release gate driver for Linux (test/cdp-test.js), the
// counterpart of run-ws-gate.ps1 with the same rules. Runs the 12 s CDP stress
// test --runs times and passes when every run has 0 % of messages over 50 ms, a
// p99 below 50 ms, and rendered frames (a run with no rAF frames is
// inconclusive, not a pass).
//
//   node linux-run-ws-gate.js --exe <electron> --out <dir> [--flags off|on] [--runs 2]
//        [--software-rendering] [--no-sandbox]
//
// --flags on adds every switch of the series (README "Everything on") and the
// --js-flags value.
// --software-rendering, --no-sandbox: only on a machine that needs them (the
// build VM: no GPU, Ubuntu 24.04); see linux-common.js. Off by default, so a
// run on a desktop with a GPU uses the GPU. Runs use the X server in $DISPLAY.
//
// Re-runs, as on Windows: a run that exited cleanly with frames but missed only
// the latency limits is run once more, and both attempts are reported; a
// second miss is a fail. A crash, a DCHECK or a run without frames is never
// re-run.
'use strict';
const fs = require('fs');
const path = require('path');
const c = require('./linux-common');

const o = c.parseArgs(process.argv.slice(2), { exe: '', out: '', flags: 'off', runs: '2' });
if (!o.exe || !o.out || !['off', 'on'].includes(o.flags)) {
  console.error('usage: node linux-run-ws-gate.js --exe <electron> --out <dir> [--flags off|on] [--runs N]');
  process.exit(2);
}
const runs = parseInt(o.runs, 10);
const say = c.summaryWriter(path.join(o.out, `ws-gate-${o.flags}.txt`),
  `WS starvation gate  flags ${o.flags}  ${c.stamp()}\nexe: ${o.exe}\nplatform args: ${c.platformArgs().join(' ')}  DISPLAY=${process.env.DISPLAY || ''}\n`);
const extra = o.flags === 'on' ? [...c.joinFeatures(c.KCC_ALL_FEATURES), `--js-flags=${c.KCC_ALL_JS_FLAGS}`] : [];

const num = (text, re) => { const m = re.exec(text); return m ? Number(m[1]) : null; };
let allPass = true;
for (let i = 1; i <= runs; i++) {
  let pass = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const label = `WS-${o.flags}-${i}`;
    const log = path.join(o.out, `ws-gate-${o.flags}-${i}.log`);
    if (attempt === 2) fs.renameSync(log, path.join(o.out, `ws-gate-${o.flags}-${i}-try1.log`));
    const code = c.runElectron(o.exe, ['cdp-test.js', String(8090 + i), label, '--enable-logging', ...extra], log);
    const text = fs.readFileSync(log, 'utf8');
    const p99 = num(text, /\]\s+p99:\s+([\d.]+)/);
    const max = num(text, /\]\s+max:\s+([\d.]+)/);
    const over = num(text, />50ms:\s+(\d+) \/ \d+/);
    const total = num(text, />50ms:\s+\d+ \/ (\d+)/);
    const frames = num(text, /RAF frames rendered: (-?\d+)/);
    const crash = c.crashLines(log);
    const clean = code === 0 && p99 !== null && frames > 0 && crash.length === 0;
    pass = clean && p99 < 50 && over === 0;
    const pct = over !== null && total ? (100 * over / total).toFixed(1) : '?';
    const tag = attempt === 2 ? `${label} (attempt 2)` : label;
    let line = `${tag.padEnd(22)} exit ${code}  p99 ${p99} ms  max ${max} ms  >50ms ${over}/${total} (${pct} %)  rAF frames ${frames}  ` +
      (pass ? 'PASS' : frames === 0 ? 'INCONCLUSIVE (no frames)' : 'FAIL');
    for (const l of crash) line += `\n    LOG: ${l}`;
    say(line);
    if (pass || !clean || attempt === 2) break;
  }
  if (!pass) allPass = false;
}
say(`WS GATE (${o.flags}): ${allPass ? 'PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
