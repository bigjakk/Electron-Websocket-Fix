// Shared by the POSIX gate and check drivers (posix-run-*.js, macOS and Linux):
// the Node port of kcc-flags.ps1. The switches of the KCC Electron 45 series
// exactly as patches/electron-45/README.md lists them under "Everything on", the
// crash pattern, and one Electron launch into a log.
//
// The drivers run under plain Node (not Electron), from any directory:
//   node test/posix-run-stage.js --exe <out>/Electron.app/Contents/MacOS/Electron --out <dir>
// They launch Electron with the test directory as the working directory, as the
// PowerShell drivers do.
//
// Prerequisite: run `npm ci` in test/ once per checkout. cdp-test.js (the
// WebSocket gate) needs the `ws` package from test/node_modules, which git does
// not track; without it every WebSocket gate run fails at startup.
//
// Display (macOS): every launch waits until the main display is awake and the
// screen unlocked, and the log records the display state before and after the
// run. A run behind a locked or sleeping display renders no frames: the drivers
// count such a run as invalid (re-run, not a failure), never as a result.
// Watched processes (macOS): the log also records the memory footprint of other
// processes that share this machine's unified memory (KCC_WATCH_PROCESSES,
// default llama-server) before and after the run, and their largest resident
// size during it; a run during which one was above KCC_WATCH_LIMIT_MB (default
// 2048) is invalid in the same way.
'use strict';

const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KCC_ALL_FEATURES = [
  'KccNoPointerLockEscCooldown', 'KccPinRawPointerLock', 'KccRawInputKeepWheelMotion',
  'KccRawInputFastPath', 'KccLeanLockedMouseMove', 'KccSkipUnobservedInputEmits',
  'KccSkipCanvasPerfSampling', 'KccLabelTexturesOnce', 'KccCacheVsyncInterval',
  'KccMacFineGpuBackpressure', 'KccAudioParamCoalesce', 'KccHrtfPannerKRateAngles',
  'KccX11AllowUnredirect', 'KccX11RawMouse', 'KccFrameCapPreciseRelease',
];
const KCC_ALL_JS_FLAGS = '--cppheap-max-incremental-sweep-duration-ms=1';

// Chromium keeps only the LAST --enable-features switch, so callers merge their
// own features into one value.
function joinKccFeatures(features) {
  const list = (features || []).filter(Boolean);
  return list.length ? [`--enable-features=${list.join(',')}`] : [];
}

// DCHECK / CHECK failures and crashes that a log can show. Case-sensitive, as in
// kcc-flags.ps1: "WATCHDOG" is what the test scripts log when they time out.
const KCC_CRASH_PATTERN = /Check failed|DCHECK failed|NOTREACHED|FATAL:|child-process-gone|render-process-gone|HARNESS ERROR|\bWATCHDOG\b/;
// A test program that did not start (a missing module, a port in use): counted
// with the crash lines, so that such a run fails visibly instead of looking like
// a run without frames.
const KCC_HARNESS_PATTERN = /App threw an error during load|Cannot find module|EADDRINUSE/;
const isCrashLine = (l) => KCC_CRASH_PATTERN.test(l) || KCC_HARNESS_PATTERN.test(l);

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Where every process of this build runs from: on macOS the browser and all of
// its helpers live inside the .app bundle; elsewhere next to the executable.
function buildRoot(exe) {
  const full = path.resolve(exe);
  const m = full.match(/^(.*?\.app)(\/|$)/);
  return m ? m[1] : path.dirname(full);
}

// Pids of the processes started from this build (browser or child). Matched on
// the executable path, not the command line, so the driver itself (whose
// arguments name the same path) never counts.
function processesOf(exe) {
  const root = buildRoot(exe) + '/';
  const pids = [];
  if (process.platform === 'linux') {
    for (const p of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(p)) continue;
      try { if (fs.readlinkSync(`/proc/${p}/exe`).startsWith(root)) pids.push(Number(p)); } catch { /* gone */ }
    }
    return pids;
  }
  // macOS: ps prints the full path of the executable as "comm".
  const out = execFileSync('ps', ['-Ao', 'pid=,comm='], { encoding: 'utf8' });
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m && m[2].startsWith(root)) pids.push(Number(m[1]));
  }
  return pids;
}

// Waits until no process of this build is left, so that one run's GPU or
// renderer process never overlaps the next run. Returns how many are left.
async function waitElectronGone(exe, timeoutMs = 20000) {
  const t0 = Date.now();
  let left = [];
  do {
    left = processesOf(exe);
    if (left.length === 0) return 0;
    await sleep(200);
  } while (Date.now() - t0 < timeoutMs);
  return left.length;
}

const quote = (a) => (/[\s"'$`\\]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a);

// macOS: the main display's refresh rate and refresh range, whether it is
// asleep, and whether the screen is locked. ok: awake and unlocked. Elsewhere
// nothing is checked and ok is always true.
const DISPLAY_JXA = 'ObjC.import("AppKit"); ObjC.import("CoreGraphics");' +
  ' const s = $.NSScreen.mainScreen; const id = $.CGMainDisplayID();' +
  ' JSON.stringify({ minInterval: s.minimumRefreshInterval, maxInterval: s.maximumRefreshInterval,' +
  ' modeHz: $.CGDisplayModeGetRefreshRate($.CGDisplayCopyDisplayMode(id)), asleep: $.CGDisplayIsAsleep(id) })';
function displayState() {
  if (process.platform !== 'darwin') return { ok: true, checked: false };
  const st = { checked: true };
  try {
    Object.assign(st, JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', DISPLAY_JXA], { encoding: 'utf8', timeout: 15000 })));
  } catch { st.unknown = true; }
  try {
    st.locked = /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8', timeout: 15000 }));
  } catch { st.locked = false; }
  st.asleep = !!st.asleep;
  st.ok = !st.locked && !st.asleep;
  return st;
}
function displayDesc(st) {
  if (!st || !st.checked) return 'not checked';
  const words = [st.asleep ? 'asleep' : 'awake', st.locked ? 'screen locked' : 'unlocked'];
  return words.join(', ') + (st.unknown ? ' (refresh state unreadable)' : '');
}
// "refresh 120 Hz (variable-rate panel, 24-120 Hz)" from displayState().
function refreshDesc(st) {
  if (!st || !st.checked || st.unknown || !st.minInterval) return 'refresh rate n/a';
  const hi = 1 / st.minInterval;
  const lo = st.maxInterval ? 1 / st.maxInterval : hi;
  const hz = Math.round(st.modeHz || hi);
  return Math.abs(hi - lo) > 1
    ? `refresh ${hz} Hz (variable-rate panel, ${Math.round(lo)}-${Math.round(hi)} Hz)`
    : `refresh ${hz} Hz (fixed rate)`;
}

// Waits (polling every 10 s, up to timeoutMs) until displayState() is ok, and
// says so through note() when it has to wait. Returns the last state.
async function waitDisplayReady(note = console.log, timeoutMs = 10 * 60 * 1000) {
  let st = displayState();
  if (st.ok) return st;
  const t0 = Date.now();
  note(`  waiting: display ${displayDesc(st)}; runs resume when it is awake and unlocked`);
  while (!st.ok && Date.now() - t0 < timeoutMs) {
    await sleep(10000);
    st = displayState();
  }
  note(st.ok ? `  display ready after ${Math.round((Date.now() - t0) / 1000)} s`
    : `  display still ${displayDesc(st)} after ${timeoutMs / 60000} min`);
  return st;
}

// The display state before and after the latest invokeElectron() run.
let lastDisplay = { before: { ok: true }, after: { ok: true } };
const lastRunDisplay = () => lastDisplay;

// Other processes whose memory can disturb a run on this machine's unified
// memory (macOS; by default an idle llama-server, which is not part of the
// tests): their footprint is recorded before and after every run and their
// resident size is sampled every 2 s during it. A run during which one of them
// was above KCC_WATCH_LIMIT_MB (default 2048) is invalid, the same way as a run
// behind a locked display. KCC_WATCH_PROCESSES: comma-separated process names.
const WATCHED = (process.env.KCC_WATCH_PROCESSES || 'llama-server').split(',').map((s) => s.trim()).filter(Boolean);
const WATCH_LIMIT_MB = Number(process.env.KCC_WATCH_LIMIT_MB || 2048);
const execFileP = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { encoding: 'utf8', timeout: 15000 }, (err, stdout) => resolve(err ? '' : stdout));
});
const UNIT_MB = { B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024, TB: 1048576 };
const mbText = (x) => (x === null || x === undefined ? 'n/a' : `${Math.round(x)} MB`);
// [{ name, pid, footprintMB, rssMB }] of the watched processes now.
async function watchedFootprints() {
  if (process.platform !== 'darwin') return [];
  const list = [];
  for (const name of WATCHED) {
    const pids = (await execFileP('pgrep', ['-x', name])).split('\n').map((x) => x.trim()).filter(Boolean);
    for (const p of pids) list.push({ name, pid: Number(p) });
  }
  for (const w of list) {
    const m = (await execFileP('footprint', ['-p', String(w.pid)])).match(/phys_footprint:\s+([\d.]+)\s*([KMGT]?B)/);
    w.footprintMB = m ? Number(m[1]) * (UNIT_MB[m[2]] || 1) : null;
    const r = (await execFileP('ps', ['-o', 'rss=', '-p', String(w.pid)])).trim();
    w.rssMB = r ? Number(r) / 1024 : null;
  }
  return list;
}
const watchDesc = (list) => (list.length
  ? list.map((w) => `${w.name} (pid ${w.pid}) footprint ${mbText(w.footprintMB)}, rss ${mbText(w.rssMB)}`).join('; ')
  : 'none running');
let lastWatch = { before: [], after: [], rssMax: new Map() };
const lastRunWatch = () => lastWatch;

// Runs electron with argv from the test directory, stdout and stderr both into
// log, and returns the exit code (128 + the signal number when the browser was
// killed by a signal, as a shell reports it). Unlike the PowerShell version, a
// browser still running after opts.timeoutMs (default 15 min) is killed, and
// processes still left 20 s after the browser exited are killed, so that a hung
// run cannot hold up or overlap the rest; the log says when either happened.
// On macOS it first waits until the display is awake and unlocked; the display
// state before and after the run is in the log and in lastRunDisplay().
async function invokeElectron(exe, argv, log, opts = {}) {
  const before = await waitDisplayReady(opts.note || console.log);
  const wBefore = await watchedFootprints();
  fs.writeFileSync(log, `# ${stamp()}  ${exe} ${argv.map(quote).join(' ')}\n# display before: ${displayDesc(before)}\n` +
    (wBefore.length ? `# watched before: ${watchDesc(wBefore)}\n` : ''));
  // Resident size of the watched processes, sampled during the run.
  const rssMax = new Map();
  let sampling = false;
  const sampler = wBefore.length ? setInterval(async () => {
    if (sampling) return;
    sampling = true;
    const out = await execFileP('ps', ['-o', 'pid=,rss=', '-p', wBefore.map((w) => w.pid).join(',')]);
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) rssMax.set(Number(m[1]), Math.max(rssMax.get(Number(m[1])) || 0, Number(m[2]) / 1024));
    }
    sampling = false;
  }, 2000) : null;
  const fd = fs.openSync(log, 'a');
  const timeoutMs = opts.timeoutMs || 15 * 60 * 1000;
  let timedOut = false;
  const child = spawn(exe, argv, {
    cwd: opts.cwd || __dirname,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, ...(opts.env || {}) },
  });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const code = await new Promise((resolve) => {
    child.on('error', (e) => {
      fs.appendFileSync(log, `HARNESS ERROR: cannot start ${exe}: ${e.message}\n`);
      resolve(-1);
    });
    child.on('exit', (c, sig) => resolve(c !== null ? c : 128 + (os.constants.signals[sig] || 0)));
  });
  clearTimeout(timer);
  fs.closeSync(fd);
  const left = await waitElectronGone(exe);
  let note = '';
  if (left) {
    for (const pid of processesOf(exe)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    await waitElectronGone(exe, 5000);
    note = `  (${left} electron processes still running 20 s after the browser exited; killed)`;
  }
  if (sampler) clearInterval(sampler);
  const after = displayState();
  const wAfter = await watchedFootprints();
  lastDisplay = { before, after };
  lastWatch = { before: wBefore, after: wAfter, rssMax };
  const maxes = [...rssMax].map(([pid, m]) => `pid ${pid} ${mbText(m)}`).join(', ');
  fs.appendFileSync(log, `# display after: ${displayDesc(after)}\n` +
    (wBefore.length || wAfter.length ? `# watched after: ${watchDesc(wAfter)}; max rss during the run: ${maxes || 'n/a'}\n` : '') +
    `# exit ${code}  ${stamp()}${timedOut ? `  (browser still running after ${timeoutMs / 1000} s; killed)` : ''}${note}\n`);
  return code;
}

// Why the latest run does not count, or null when it counts: the display was
// asleep or locked before or after it, or a watched process (see WATCHED) was
// above the limit before, during or after it.
function runInvalid() {
  const { before, after } = lastDisplay;
  if (!before.ok) return `display ${displayDesc(before)} before the run`;
  if (!after.ok) return `display ${displayDesc(after)} at the end of the run`;
  const over = [];
  for (const w of [...lastWatch.before, ...lastWatch.after]) {
    const m = Math.max(w.footprintMB || 0, w.rssMB || 0);
    if (m > WATCH_LIMIT_MB) over.push(`${w.name} at ${mbText(m)}`);
  }
  for (const [pid, m] of lastWatch.rssMax) if (m > WATCH_LIMIT_MB) over.push(`pid ${pid} at ${mbText(m)} resident during the run`);
  return over.length ? `watched process above ${WATCH_LIMIT_MB} MB: ${[...new Set(over)].join(', ')}` : null;
}

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return []; }
}
// The first n lines of a log that match the crash or harness pattern, trimmed.
function crashLines(log, n = 3) {
  return readLines(log).filter(isCrashLine).slice(0, n).map((l) => l.trim());
}
function crashCount(log) {
  return readLines(log).filter(isCrashLine).length;
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// One line on the watched processes across every log under dir: how many runs
// recorded them, the range of their footprint before and after the runs, and
// the largest resident size sampled during any run.
function watchSummary(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.log')) files.push(p);
    }
  };
  try { walk(dir); } catch { return 'watched processes: n/a'; }
  const fp = [];
  let runs = 0;
  let rssMax = 0;
  for (const f of files) {
    let seen = false;
    for (const l of readLines(f)) {
      if (!l.startsWith('# watched')) continue;
      seen = true;
      for (const m of l.matchAll(/footprint (\d+) MB/g)) fp.push(Number(m[1]));
      const mm = l.match(/max rss during the run: (.*)$/);
      if (mm) for (const x of mm[1].matchAll(/(\d+) MB/g)) rssMax = Math.max(rssMax, Number(x[1]));
    }
    if (seen) runs++;
  }
  if (!runs) return `watched processes (${WATCHED.join(', ')}): not running during any run`;
  return `watched processes (${WATCHED.join(', ')}): ${runs} runs recorded them; footprint before/after ` +
    `${fp.length ? `${Math.min(...fp)}-${Math.max(...fp)} MB` : 'n/a'}; largest resident size sampled during a run ${rssMax} MB ` +
    `(a run above ${WATCH_LIMIT_MB} MB is invalid)`;
}

// --name value or --name=value. Values stay strings; lists are comma-separated.
function parseArgs(argv, defaults) {
  const o = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) throw new Error(`unexpected argument ${argv[i]}`);
    o[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return o;
}
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

// A summary file that every line also goes to stdout with.
function makeSummary(file, header) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${header}\n`);
  return (s) => { fs.appendFileSync(file, `${s}\n`); console.log(s); };
}

const r1 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : x);
const fix = (x, d) => (x === null || x === undefined || Number.isNaN(Number(x)) ? 'n/a' : Number(x).toFixed(d));

// Session and display, for the summaries: rAF stops in a locked or headless
// session, and on macOS a launch outside the GUI session has no Metal.
function machineNotes() {
  const parts = [];
  if (process.platform === 'darwin') {
    try { parts.push(`session ${execFileSync('launchctl', ['managername'], { encoding: 'utf8' }).trim()}`); } catch { /* n/a */ }
    try {
      const j = JSON.parse(execFileSync('system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8' }));
      for (const gpu of j.SPDisplaysDataType || []) {
        for (const d of gpu.spdisplays_ndrvs || []) {
          parts.push(`display ${d._name}: ${d._spdisplays_resolution || d._spdisplays_pixels || '?'}${d.spdisplays_main === 'spdisplays_yes' ? ' (main)' : ''}`);
        }
      }
    } catch { /* n/a */ }
    const st = displayState();
    parts.push(`main display ${refreshDesc(st)}, ${displayDesc(st)}`);
    try {
      const pm = execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf8' });
      parts.push(`display sleep held off: ${/PreventUserIdleDisplaySleep\s+1/.test(pm) ? 'yes' : 'no'}`);
    } catch { /* n/a */ }
  } else {
    parts.push(`XDG_SESSION_TYPE ${process.env.XDG_SESSION_TYPE || '?'}, DISPLAY ${process.env.DISPLAY || '?'}`);
  }
  return parts.join('; ');
}

// macOS: keep the display (and the machine) awake for as long as this driver
// runs. caffeinate -w exits on its own when the driver does.
function keepAwake() {
  if (process.platform !== 'darwin') return;
  const c = spawn('caffeinate', ['-d', '-i', '-w', String(process.pid)], { stdio: 'ignore', detached: true });
  c.unref();
}

// Runs a driver's main(argv) as a program: exit code 0 pass, 1 fail, 2 error.
function runMain(main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { console.error(e && e.stack ? e.stack : e); process.exit(2); });
}

module.exports = {
  KCC_ALL_FEATURES, KCC_ALL_JS_FLAGS, KCC_CRASH_PATTERN,
  joinKccFeatures, invokeElectron, waitElectronGone, processesOf,
  crashLines, crashCount, readJson, parseArgs, list, makeSummary,
  stamp, r1, fix, machineNotes, keepAwake, runMain,
  displayState, displayDesc, refreshDesc, waitDisplayReady, lastRunDisplay,
  watchedFootprints, watchDesc, lastRunWatch, runInvalid, watchSummary,
  // The drivers ask this before counting a run (display and watched processes).
  displayInvalid: runInvalid,
};
