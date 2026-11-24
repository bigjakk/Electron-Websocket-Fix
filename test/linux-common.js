// Shared by the Linux gate and check drivers (linux-run-*.js), the Linux
// counterpart of kcc-flags.ps1: the switches of the KCC Electron 45 series,
// exactly as patches/electron-45/README.md lists them under "Everything on",
// and how one Electron run is started and logged.
//
// Every run gets --ozone-platform=x11 (the client runs on X11) and, unless
// KCC_SANDBOX=1 is set, --no-sandbox: Ubuntu 24.04 restricts unprivileged user
// namespaces, so a build tree's electron cannot start its sandbox there. Runs
// use the X server in $DISPLAY (see linux-x11-env.sh).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KCC_ALL_FEATURES = [
  'KccNoPointerLockEscCooldown', 'KccPinRawPointerLock', 'KccRawInputKeepWheelMotion',
  'KccRawInputFastPath', 'KccLeanLockedMouseMove', 'KccSkipUnobservedInputEmits',
  'KccSkipCanvasPerfSampling', 'KccLabelTexturesOnce', 'KccCacheVsyncInterval',
  'KccMacFineGpuBackpressure', 'KccAudioParamCoalesce', 'KccHrtfPannerKRateAngles',
  'KccX11AllowUnredirect', 'KccX11RawMouse', 'KccFrameCapPreciseRelease',
];
const KCC_ALL_JS_FLAGS = '--cppheap-max-incremental-sweep-duration-ms=1';

// Chromium keeps only the LAST --enable-features switch: merge into one value.
function joinFeatures(features) {
  const list = (features || []).filter(Boolean);
  return list.length ? [`--enable-features=${list.join(',')}`] : [];
}

// DCHECK / CHECK failures and crashes a log can show; case-sensitive, as in
// kcc-flags.ps1 ("WATCHDOG" is what the test scripts log when they time out).
const CRASH_PATTERN = /Check failed|DCHECK failed|NOTREACHED|FATAL:|child-process-gone|render-process-gone|HARNESS ERROR|\bWATCHDOG\b/;

const PLATFORM_ARGS = ['--ozone-platform=x11', ...(process.env.KCC_SANDBOX === '1' ? [] : ['--no-sandbox'])];

// Command line options of the drivers: --name value or --name=value.
function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`unexpected argument ${argv[i]}`);
    const key = m[1];
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
  const args = [...argv, ...PLATFORM_ARGS];
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
  KCC_ALL_FEATURES, KCC_ALL_JS_FLAGS, CRASH_PATTERN, PLATFORM_ARGS, joinFeatures, parseArgs, list, stamp,
  runElectron, crashLines, readJson, summaryWriter, fmt1, median, electronPids,
};
