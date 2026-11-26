// Everything Stage 2 / Stage 3 of the KCC Electron 45 build brief runs on one
// binary on Linux, the counterpart of run-stage.ps1: gpu-status.json, both
// release gates with the switches off and with every switch on, then the
// synthetic checks (linux-run-checks.js).
//
//   node linux-run-stage.js --exe <electron> --out <dir> [--part gates|checks|all]
//        [--ws-runs 6] [--features-via commandline|js] [--cap-page-mode webgl|2d]
//        [--heavy-runs 5] [--software-rendering] [--no-sandbox]
//
//   gates   gpu-status.json; WS gate off and on (--ws-runs runs each; the brief's
//           drivers use 2, the build VM was marginal at v44, so 6 by default);
//           frame-cap gate "off" and "all" (heavy runs interleaved)
//   checks  linux-run-checks.js (every check)
//
// --features-via js: the frame-cap gate passes its --enable-features list through
//   the main script (needed on a DCHECK build; see frame-cap-test.js).
// --cap-page-mode: page of the frame-cap gate's heavy suite.
// --software-rendering, --no-sandbox: only on a machine that needs them, passed
//   on to every driver; off by default, so a run on a desktop with a GPU uses
//   the GPU (see linux-common.js for what each does and why).
//
// Runs use the X server in $DISPLAY.
//
//   The build VM (no GPU, no desktop, Ubuntu 24.04):
//     eval "$(test/linux-x11-env.sh start 1 | grep ^export)"   # Xorg dummy, openbox
//     node test/linux-run-stage.js --exe <electron> --out <dir> --software-rendering --no-sandbox
//   A desktop with a GPU, in its X11 session (Xorg; DISPLAY already set):
//     node test/linux-run-stage.js --exe <electron> --out <dir>   # add --no-sandbox only if electron will not start
//
// Every part appends its verdict lines to <out>/stage-summary.txt, which also
// records the platform switches, the GPU feature status and the WebGL renderer
// string of the binary (gpu-status.js), and warns when a run without
// --software-rendering did not get GPU compositing.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const c = require('./linux-common');

const o = c.parseArgs(process.argv.slice(2), { exe: '', out: '', part: 'all', 'ws-runs': '6', 'features-via': 'commandline', 'cap-page-mode': 'webgl', 'heavy-runs': '5' });
if (!o.exe || !o.out || !['gates', 'checks', 'all'].includes(o.part)) {
  console.error('usage: node linux-run-stage.js --exe <electron> --out <dir> [--part gates|checks|all] ...');
  process.exit(2);
}
const OUT = path.resolve(o.out);
fs.mkdirSync(OUT, { recursive: true });
const stage = path.join(OUT, 'stage-summary.txt');
const note = (s) => { fs.appendFileSync(stage, `${s}\n`); console.log(s); };
// Verdict lines: one per gate run or check, its failures, skips and re-runs,
// the heavy-suite comparison, and the final verdict of each driver.
const VERDICT = /^(WS GATE|FRAME-CAP GATE|SYNTHETIC CHECKS)|^\S+\s+(PASS|FAIL|SKIP|N\/A|INFO)\s|^\S+( \(attempt \d\))?\s+exit -?\d+|^\s+(FAIL|SKIP|LOG:|FROZE)|^heavy suite|^\s+\S+\s+reach\s|^\s+rates \(fps\):|\s(ok|DROP)$/;
function sub(script, args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });
  const lines = `${r.stdout || ''}${r.stderr || ''}`.split('\n');
  for (const l of lines) if (l) console.log(l);
  for (const l of lines) if (VERDICT.test(l)) fs.appendFileSync(stage, `  ${l}\n`);
  return r.status;
}

const env = `DISPLAY=${process.env.DISPLAY || ''}`;
note(`== ${o.part}  ${c.stamp()}  exe ${o.exe}  features via ${o['features-via']}, heavy page ${o['cap-page-mode']}  ${env}  platform args: ${c.platformArgs().join(' ')}`);

if (o.part === 'gates' || o.part === 'all') {
  const gpuJson = path.join(OUT, 'gpu-status.json');
  const gpuLog = path.join(OUT, 'gpu-status.log');
  const gpuCode = c.runElectron(o.exe, ['gpu-status.js', `--kcc-out=${gpuJson}`], gpuLog);
  const g = c.readJson(gpuJson);
  if (g) {
    const v = g.versions || {}; const s = g.gpuFeatureStatus || {};
    note(`  versions: electron ${v.electron}, chrome ${v.chrome}, v8 ${v.v8}, node ${v.node}`);
    note(`  gpu_compositing ${s.gpu_compositing}, webgl ${s.webgl}; WebGL2 renderer: ${(((g.webgl || {}).webgl2) || {}).renderer}`);
    const info = g.gpuInfoBasic || {};
    const devs = (info.gpuDevice || []).map((d) => `${Number(d.vendorId).toString(16).padStart(4, '0')}:${Number(d.deviceId).toString(16).padStart(4, '0')}${d.active ? ' (active)' : ''}`);
    note(`  GPU devices (PCI vendor:device): ${devs.join(', ') || 'none'}; GL implementation: ${(info.auxAttributes || {}).glImplementationParts}`);
    if (process.env.KCC_SOFTWARE_RENDERING !== '1' && !/^enabled/.test(String(s.gpu_compositing))) {
      note(`  WARNING: no GPU compositing (${s.gpu_compositing}) although --software-rendering is off: these results are software-rendering results`);
    }
  } else {
    // No result: say why (on a machine without a GPU and without
    // --software-rendering, Chromium disables GPU access after the GPU process
    // crashes, and gpu-status.js stops there).
    let why = '';
    try { why = fs.readFileSync(gpuLog, 'utf8').split('\n').filter((l) => /HARNESS ERROR|WATCHDOG|GPU access/.test(l)).slice(0, 2).map((l) => l.trim()).join(' / '); } catch { why = 'no log'; }
    note(`  gpu-status.js: no result (exit ${gpuCode})${why ? `: ${why}` : ''}`);
    note('  WARNING: GPU state unknown; the runs below may not be using the GPU');
  }
  for (const flags of ['off', 'on']) sub('linux-run-ws-gate.js', ['--exe', o.exe, '--out', OUT, '--flags', flags, '--runs', o['ws-runs']]);
  sub('linux-run-frame-cap-gate.js', ['--exe', o.exe, '--out', OUT, '--variants', 'off,all', '--features-via', o['features-via'], '--heavy-mode', o['cap-page-mode'], '--heavy-runs', o['heavy-runs']]);
}
if (o.part === 'checks' || o.part === 'all') {
  sub('linux-run-checks.js', ['--exe', o.exe, '--out', path.join(OUT, 'checks')]);
}
note(`== ${o.part} done  ${c.stamp()}`);
