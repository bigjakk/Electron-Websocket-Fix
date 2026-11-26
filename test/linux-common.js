// Shared by the Linux gate and check drivers (linux-run-*.js), the Linux
// counterpart of kcc-flags.ps1: the switches of the KCC Electron 45 series,
// exactly as patches/electron-45/README.md lists them under "Everything on",
// and how one Electron run is started and logged.
//
// Platform switches. Every run gets --ozone-platform=x11 (the client runs on
// X11, also under XWayland) and uses the X server in $DISPLAY, whatever it is:
// a desktop session, or the test server of linux-x11-env.sh. Two more switches
// are for particular machines only. They are OFF unless asked for, so that a
// run on a desktop with a GPU never gets them by accident, and every summary
// and log header records the switches its runs used. Every driver takes them
// as options (and passes them on to the drivers it starts):
//
//   --software-rendering   (or KCC_SOFTWARE_RENDERING=1)
//       adds --disable-gpu --enable-unsafe-swiftshader, for a machine WITHOUT a
//       GPU, such as the build VM. Without them the GPU process there exits at
//       start-up until Chromium disables GPU access, and WebGL is unavailable.
//       With --enable-unsafe-swiftshader alone the GPU process first fails on
//       hardware GL and the page's WebGL context is lost at load (5 of 5
//       launches of webgl-startup-test.js on the build VM); with --disable-gpu
//       as well it starts in software mode at once (0 of 5 lost). The display
//       compositor then runs its software output path and WebGL runs on ANGLE
//       over SwiftShader: what the Windows build machine had (software
//       compositing, WebGL on WARP). Never on a machine with a GPU: the run
//       would measure the software rasteriser, not the GPU.
//   --no-sandbox   (or KCC_NO_SANDBOX=1)
//       adds --no-sandbox, only where Chromium's sandbox cannot start: Ubuntu
//       23.10 and later restrict unprivileged user namespaces (AppArmor), and
//       the chrome-sandbox helper of a build tree or of an unpacked dist.zip is
//       not setuid root, so electron exits at start-up there (the build VM, the
//       v42 to v44 Linux tests). Elsewhere, or with chrome-sandbox made
//       root-owned and mode 4755, leave it out.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KCC_ALL_FEATURES = [
  'KccNoPointerLockEscCooldown', 'KccSkipCanvasPerfSampling', 'KccCacheVsyncInterval',
  'KccMacFineGpuBackpressure', 'KccAudioParamCoalesce', 'KccFrameCapPreciseRelease',
];

// Chromium keeps only the LAST --enable-features switch: merge into one value.
function joinFeatures(features) {
  const list = (features || []).filter(Boolean);
  return list.length ? [`--enable-features=${list.join(',')}`] : [];
}

// DCHECK / CHECK failures and crashes a log can show; case-sensitive, as in
// kcc-flags.ps1 ("WATCHDOG" is what the test scripts log when they time out).
const CRASH_PATTERN = /Check failed|DCHECK failed|NOTREACHED|FATAL:|child-process-gone|render-process-gone|HARNESS ERROR|\bWATCHDOG\b/;

// The two machine-specific switches (see the top of this file): driver option
// and the environment variable that carries it to the drivers a driver starts.
const MACHINE_OPTIONS = { 'software-rendering': 'KCC_SOFTWARE_RENDERING', 'no-sandbox': 'KCC_NO_SANDBOX' };
if (process.env.KCC_SANDBOX !== undefined || process.env.KCC_NO_SWIFTSHADER !== undefined) {
  // Names of an earlier revision, where both switches were on by default.
  throw new Error('KCC_SANDBOX and KCC_NO_SWIFTSHADER are no longer read: the switches are now off unless asked for (--no-sandbox, --software-rendering)');
}

// The platform switches every run gets, from the options above.
function platformArgs() {
  return [
    '--ozone-platform=x11',
    ...(process.env.KCC_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ...(process.env.KCC_SOFTWARE_RENDERING === '1' ? ['--disable-gpu', '--enable-unsafe-swiftshader'] : []),
  ];
}

// Command line options of the drivers: --name value or --name=value, plus the
// machine options (--software-rendering, --no-sandbox: no value, or =1 / =0),
// which every driver takes and which go into the environment.
function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`unexpected argument ${argv[i]}`);
    const key = m[1];
    if (key in MACHINE_OPTIONS) {
      if (m[2] !== undefined && m[2] !== '0' && m[2] !== '1') throw new Error(`--${key} takes no value (or =1, =0)`);
      process.env[MACHINE_OPTIONS[key]] = m[2] === '0' ? '0' : '1';
      continue;
    }
    if (!(key in out)) throw new Error(`unknown option --${key}`);
    out[key] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return out;
}
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function stamp() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }

// PIDs whose executable is |exeReal| (browser, zygote, GPU, renderers...).
function electronPids(exeReal) {
  const pids = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { if (fs.readlinkSync(`/proc/${d}/exe`) === exeReal) pids.push(Number(d)); } catch { /* gone or not ours */ }
  }
  return pids;
}

// Waits until no process of this electron is left, so that one run's GPU or
// renderer process never overlaps the next run. Returns how many are left.
function waitElectronGone(exeReal, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let left = electronPids(exeReal);
  while (left.length && Date.now() < end) {
    spawnSync('sleep', ['0.2']);
    left = electronPids(exeReal);
  }
  return left.length;
}

// Runs electron with |argv| from the test directory, stdout and stderr into
// |log|, and returns the exit code (signals as 128+n).
function runElectron(exe, argv, log, { env = {}, timeoutMs = 20 * 60 * 1000 } = {}) {
  const exeReal = fs.realpathSync(exe);
  const args = [...argv, ...platformArgs()];
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, `# ${stamp()}  ${exe} ${args.join(' ')}\n`);
  const fd = fs.openSync(log, 'a');
  const r = spawnSync(exe, args, { cwd: __dirname, stdio: ['ignore', fd, fd], env: { ...process.env, ...env }, timeout: timeoutMs, killSignal: 'SIGKILL' });
  fs.closeSync(fd);
  let code = r.status;
  if (code === null) code = r.signal ? 128 + (require('os').constants.signals[r.signal] || 0) : -1;
  const left = waitElectronGone(exeReal);
  if (left) for (const pid of electronPids(exeReal)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  fs.appendFileSync(log, `# exit ${code}  ${stamp()}${r.error ? `  (${r.error.code || r.error.message})` : ''}${left ? `  (${left} electron processes still running 20 s after the browser exited; killed)` : ''}\n`);
  return code;
}

function crashLines(log, max = 3) {
  try {
    return fs.readFileSync(log, 'utf8').split('\n').filter((l) => CRASH_PATTERN.test(l)).slice(0, max).map((l) => l.trim());
  } catch { return ['log missing']; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// A summary file that also echoes to stdout.
function summaryWriter(file, header) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, header.endsWith('\n') ? header : `${header}\n`);
  return (s) => { fs.appendFileSync(file, `${s}\n`); console.log(s); };
}

const fmt1 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(1) : String(x));
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

module.exports = {
  KCC_ALL_FEATURES, CRASH_PATTERN, platformArgs, joinFeatures, parseArgs, list, stamp,
  runElectron, crashLines, readJson, summaryWriter, fmt1, median, electronPids,
};
