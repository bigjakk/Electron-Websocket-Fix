// Heavy-suite re-measurement with an A/A control, for Linux: the frame-cap gate's
// heavy suite (frame-cap-test.js --kcc-suite=heavy) at one busy value, with a
// second "off" arm that has the same command line as "off". Run it only when a
// heavy comparison of linux-run-frame-cap-gate.js missed. It reports and gives no
// verdict: the gate's result stands as run.
//
//   node linux-run-heavy-aa.js --exe <electron> --out <dir>
//       [--busy 3] [--rounds 10] [--arms off,all,off2] [--heavy-mode webgl|2d]
//       [--features-via commandline|js] [--software-rendering] [--no-sandbox]
//
// Arms: off (no KCC switch), all (every switch of the series, as in the gate),
// off2 (the same command line as off). Every round runs each arm once, the order
// rotated from round to round (round r starts with the arm at position
// (r - 1) mod N of --arms). Every run is reported, and none is repeated. The CPU
// steal time over each run is taken from /proc/stat, so that a slow run can be
// set against what a VM's host took.
//
// Report: every run per arm, best and median per arm; best against best (the
// gate's ratio) for every arm against off, and for all against off2; per-round
// paired differences against off, with their median and the number of rounds
// below zero. How to read it, fixed before any result: off2 against off is the
// machine's own resolution; if it moves about as much as all against off (best or
// paired median), the gate's 3 % rule cannot be resolved on that machine.
'use strict';
const fs = require('fs');
const path = require('path');
const c = require('./linux-common');

const o = c.parseArgs(process.argv.slice(2), {
  exe: '', out: '', busy: '3', rounds: '10', arms: 'off,all,off2', 'heavy-mode': 'webgl', 'features-via': 'commandline',
});
const ROUNDS = parseInt(o.rounds, 10);
const BUSY = Number(o.busy);
const ARMS = c.list(o.arms);
const KNOWN = ['off', 'off2', 'all'];
if (!o.exe || !o.out || !(ROUNDS > 0) || !(BUSY > 0) || ARMS[0] !== 'off' || ARMS.some((a) => !KNOWN.includes(a)) || new Set(ARMS).size !== ARMS.length) {
  console.error('usage: node linux-run-heavy-aa.js --exe <electron> --out <dir> [--busy 3] [--rounds 10] [--arms off,all,off2] ...');
  console.error(`  --arms: starts with off; any of ${KNOWN.join(', ')}`);
  process.exit(2);
}
function featureArgs(features) {
  const a = c.joinFeatures(features);
  return o['features-via'] === 'js' ? a.map((s) => s.replace(/^--enable-features=/, '--kcc-features=')) : a;
}
const ARM_ARGS = { off: [], off2: [], all: featureArgs(c.KCC_ALL_FEATURES) };
const base = ['frame-cap-test.js', '--kcc-suite=heavy', `--kcc-busy=${BUSY}`, `--kcc-mode=${o['heavy-mode']}`];
const say = c.summaryWriter(path.join(o.out, 'summary-heavy-aa.txt'),
  `heavy-suite A/A re-measurement  ${c.stamp()}  busy ${BUSY} ms, page ${o['heavy-mode']}, ${ROUNDS} rounds, arms ${ARMS.join(', ')}\n` +
  `exe: ${o.exe}\nplatform args: ${c.platformArgs().join(' ')}  DISPLAY=${process.env.DISPLAY || ''}\n` +
  ARMS.map((a) => `  ${a}: ${[...base, ...ARM_ARGS[a], `--kcc-out=<dir>/aa-${a}-rN.json`, '--enable-logging', ...c.platformArgs()].join(' ')}`).join('\n') + '\n');

// /proc/stat "cpu" line: user nice system idle iowait irq softirq steal guest
// guest_nice; guest time is already counted in user, so the total ends at steal.
function cpuStat() {
  try {
    const f = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    return { total: f.slice(0, 8).reduce((a, b) => a + b, 0), steal: f[7] };
  } catch { return { total: NaN, steal: NaN }; }
}

const KEYS = ['reach', 'cap1000', 'cap240', 'cap144'];
const runs = [];
for (let r = 1; r <= ROUNDS; r++) {
  const k = (r - 1) % ARMS.length;
  const order = [...ARMS.slice(k), ...ARMS.slice(0, k)];
  say(`round ${r}: order ${order.join(', ')}`);
  order.forEach((arm, pos) => {
    const json = path.join(o.out, `aa-${arm}-r${r}.json`);
    const log = path.join(o.out, `aa-${arm}-r${r}.log`);
    fs.rmSync(json, { force: true });
    const s0 = cpuStat(); const t0 = Date.now();
    const code = c.runElectron(o.exe, [...base, ...ARM_ARGS[arm], `--kcc-out=${json}`, '--enable-logging'], log);
    const s1 = cpuStat(); const secs = (Date.now() - t0) / 1000;
    const stealPct = (100 * (s1.steal - s0.steal)) / (s1.total - s0.total);
    const res = c.readJson(json);
    const crash = c.crashLines(log);
    const froze = Boolean(res && (res.measurements || []).some((m) => m.error));
    const renderer = res && res.pageRenderer;
    const noWebgl = o['heavy-mode'] === 'webgl' && renderer !== 'webgl2';
    const valid = Boolean(res) && !froze && crash.length === 0 && !noWebgl && KEYS.every((q) => Number.isFinite(Number(res[q])));
    runs.push({ round: r, pos: pos + 1, arm, code, valid, res });
    let line = `  ${`${arm}-r${r}`.padEnd(14)} pos ${pos + 1}  exit ${code}  ${secs.toFixed(0)} s  steal ${Number.isFinite(stealPct) ? stealPct.toFixed(2) : '?'} %`;
    if (res) {
      const checks = res.checks || [];
      const gpu = (res.gpuFeatureStatus || {}).gpu_compositing;
      const dev = (res.gpuDevices || []).filter((d) => d.active).map((d) => `${d.vendorId.toString(16).padStart(4, '0')}:${d.deviceId.toString(16).padStart(4, '0')}`).join(',');
      line += `  checks ${checks.filter((q) => q.pass).length}/${checks.length}  ${KEYS.map((q) => `${q} ${c.fmt1(Number(res[q]))}`).join('  ')}  page ${renderer}, gpu_compositing ${gpu}, GPU ${dev}`;
      for (const f of checks.filter((q) => !q.pass)) line += `\n      FAIL ${f.name}: ${f.detail}`;
    } else line += '  NO RESULT FILE';
    if (froze) line += '\n      FROZE: a measurement timed out';
    if (res && noWebgl) line += `\n      page renderer ${renderer}: WebGL2 unavailable, the page drew on a 2D canvas`;
    for (const l of crash) line += `\n      LOG: ${l}`;
    if (!valid) line += '\n      (not used below)';
    say(line);
  });
}

const pct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
const vals = (arm, q) => runs.filter((x) => x.arm === arm && x.valid).map((x) => Number(x.res[q]));
const inRound = (arm, q, r) => { const x = runs.find((y) => y.arm === arm && y.round === r && y.valid); return x ? Number(x.res[q]) : NaN; };
say('');
say(`every valid run per arm: best / median [each run, round 1 first]; ${runs.filter((x) => !x.valid).length} run(s) not valid, ${runs.filter((x) => x.code !== 0).length} with a non-zero exit`);
for (const q of KEYS) {
  say(`${q}:`);
  for (const a of ARMS) {
    const v = vals(a, q);
    say(`  ${a.padEnd(9)} best ${c.fmt1(v.length ? Math.max(...v) : NaN).padStart(6)} / median ${c.fmt1(c.median(v)).padStart(6)}  [${v.map(c.fmt1).join(' / ')}]`);
  }
}
const pairs = ARMS.slice(1).map((a) => [a, 'off']);
if (ARMS.includes('all') && ARMS.includes('off2')) pairs.splice(pairs.findIndex((p) => p[0] === 'all') + 1, 0, ['all', 'off2']);
say('');
say('best against best, the gate\'s ratio (medians in brackets):');
for (const q of KEYS) {
  say(`  ${q.padEnd(8)} ${pairs.map(([a, b]) => {
    const va = vals(a, q); const vb = vals(b, q);
    const r1 = Math.max(...va) / Math.max(...vb); const r2 = c.median(va) / c.median(vb);
    return `${a} vs ${b} ${pct((r1 - 1) * 100)} % (${pct((r2 - 1) * 100)} %)`;
  }).join('   ')}`);
}
say('');
say('paired per round, arm - off in fps (rounds where both runs are valid): median, rounds below zero [each round]');
for (const q of KEYS) {
  for (const a of ARMS.slice(1)) {
    const d = [];
    for (let r = 1; r <= ROUNDS; r++) { const x = inRound(a, q, r); const y = inRound('off', q, r); if (Number.isFinite(x) && Number.isFinite(y)) d.push(x - y); }
    const md = c.median(d);
    say(`  ${q.padEnd(8)} ${`${a} - off`.padEnd(15)} median ${pct(md)} fps (${pct((100 * md) / c.median(vals('off', q)))} % of off's median)  below zero ${d.filter((x) => x < 0).length} of ${d.length}  [${d.map(pct).join(' ')}]`);
  }
}
say(`\nend ${c.stamp()}`);
