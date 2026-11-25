// Everything Stage 2 / Stage 3 of the KCC Electron 45 build runs on one binary,
// for macOS and Linux: the Node port of run-stage.ps1. Both release gates with
// the switches off and with every switch on, then the synthetic checks.
//
//   node posix-run-stage.js --exe <electron> --out <dir> [--part gates|checks|c32|all]
//                     [--features-via commandline|js] [--cap-page-mode webgl|2d]
//
// Prerequisite: `npm ci` in test/ once per checkout (the WebSocket gate's
// cdp-test.js needs the `ws` package from test/node_modules).
//
//   gates   gpu-status.json; WS gate off; WS gate on; frame-cap gate "off" and
//           "all" (heavy runs interleaved)
//   checks  posix-run-checks.js (every check)
//   c32     macOS only: mac-run-gpu-backpressure.js (stock trace, then the
//           uncapped rate with the switch off and on, alternating) into <out>/c32
//   all     gates, checks and (on macOS) c32
// (run-stage.ps1's "cap-switches" part is the frame-cap gate of c60's switch,
// which is Windows-only.)
//
// --features-via js: the frame-cap gate passes its --enable-features list through
//   the main script (needed on a DCHECK build; see frame-cap-test.js).
// --cap-page-mode: page of the lat check and of the frame-cap gate's heavy suite.
//
// Run it from the logged-in desktop session with the screen unlocked: a locked
// or headless session stops requestAnimationFrame, and on macOS a launch from
// outside the GUI session has no Metal. The display is kept awake while it runs.
// Every part appends its verdict lines to <out>/stage-summary.txt.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const k = require('./posix-kcc-flags');

// Verdict lines: one per gate run or check, its failures, skips and re-runs,
// the heavy-suite comparison, and the final verdict of each driver.
const VERDICT = /^(WS GATE|FRAME-CAP GATE|SYNTHETIC CHECKS)|^c32 |^\S+\s+(PASS|FAIL|N\/A|INFO)\s|^\S+( \(attempt \d\))?\s+exit -?\d+|^\s+(FAIL|SKIP|LOG:|FROZE|INVALID)|^\s+(waiting:|display (ready|still))|no valid attempt|^heavy suite|^\s+\S+\s+reach\s|\s(ok|DROP)$/;

async function main(argv) {
  const a = k.parseArgs(argv, { part: 'all', 'features-via': 'commandline', 'cap-page-mode': 'webgl' });
  if (!a.exe || !a.out || !['gates', 'checks', 'c32', 'all'].includes(a.part)) {
    console.log('usage: node posix-run-stage.js --exe <electron> --out <dir> [--part gates|checks|c32|all] [--features-via commandline|js] [--cap-page-mode webgl|2d]');
    return 2;
  }
  k.keepAwake();
  fs.mkdirSync(a.out, { recursive: true });
  const stage = path.join(a.out, 'stage-summary.txt');
  const note = (s) => { fs.appendFileSync(stage, `${s}\n`); console.log(s); };
  let failed = false;
  async function sub(script, args) {
    const child = spawn(process.execPath, [path.join(__dirname, script), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const onData = (d) => { process.stdout.write(d); buf += d; };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)));
    for (const line of buf.split(/\r?\n/)) if (VERDICT.test(line)) note(`  ${line}`);
    if (code !== 0) failed = true;
  }

  note(`== ${a.part}  ${k.stamp()}  exe ${a.exe}  features via ${a['features-via']}, lat/heavy page ${a['cap-page-mode']}`);
  note(`  ${k.machineNotes()}`);
  if (a.part === 'gates' || a.part === 'all') {
    const gs = path.join(a.out, 'gpu-status.json');
    await k.invokeElectron(a.exe, ['gpu-status.js', `--kcc-out=${gs}`], path.join(a.out, 'gpu-status.log'));
    const g = k.readJson(gs);
    if (g) {
      note(`  versions: electron ${g.versions.electron}, chrome ${g.versions.chrome}, v8 ${g.versions.v8}, node ${g.versions.node}`);
      note(`  gpu_compositing ${g.gpuFeatureStatus.gpu_compositing}, webgl ${g.gpuFeatureStatus.webgl}; WebGL2 renderer: ${g.webgl && g.webgl.webgl2 ? g.webgl.webgl2.renderer : 'none'}`);
    } else {
      note('  gpu-status: NO RESULT FILE');
      failed = true;
    }
    await sub('posix-run-ws-gate.js', ['--exe', a.exe, '--out', a.out, '--flags', 'off']);
    await sub('posix-run-ws-gate.js', ['--exe', a.exe, '--out', a.out, '--flags', 'on']);
    await sub('posix-run-frame-cap-gate.js', ['--exe', a.exe, '--out', a.out, '--variants', 'off,all',
      '--features-via', a['features-via'], '--heavy-mode', a['cap-page-mode']]);
  }
  if (a.part === 'checks' || a.part === 'all') {
    await sub('posix-run-checks.js', ['--exe', a.exe, '--out', path.join(a.out, 'checks'), '--cap-page-mode', a['cap-page-mode']]);
  }
  if ((a.part === 'c32' || a.part === 'all') && process.platform === 'darwin') {
    await sub('mac-run-gpu-backpressure.js', ['--exe', a.exe, '--out', path.join(a.out, 'c32')]);
  }
  note(`  ${k.watchSummary(a.out)}`);
  note(`== ${a.part} done  ${k.stamp()}`);
  return failed ? 1 : 0;
}

if (require.main === module) k.runMain(main);
module.exports = { main };
