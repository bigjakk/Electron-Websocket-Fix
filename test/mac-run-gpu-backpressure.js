// c32 (KccMacFineGpuBackpressure) driver for macOS: the stock trace first, then
// the uncapped rate of each variant, several launches each, in rotating order.
// Runs mac-gpu-backpressure-test.js (with --disable-frame-rate-limit
// --disable-gpu-vsync as the gates use them) under plain Node.
//
//   node mac-run-gpu-backpressure.js --exe <electron> --out <dir>
//       [--variants off,on] variants, measured in this order in round 1 and
//                           rotated by one place every round:
//                             off          no switch
//                             on, c32      KccMacFineGpuBackpressure only
//                             all-but-c32  every switch of the series except c32
//                             all          every switch of the series
//                           ("every switch": README "Everything on", --js-flags included)
//       [--runs 6]          untraced launches per variant
//       [--page heavy|frame-cap]  heavy (default): the GPU-bound mac-gpu-heavy.html;
//                           frame-cap: the gates' light page frame-cap.html
//       [--mode webgl|2d]   frame-cap page only (default webgl)
//       [--iters 256]       heavy page: fragment-shader loop iterations
//       [--warmup-ms 3000] [--window-ms 5000]
//       [--trace yes|no]    first one traced launch of "off" and one of the c32
//                           variant (on or c32) if listed (default yes)
//       [--categories gpu,cc,viz]
//
// The switches go on the command line without a field-trial parameter (poll_us
// keeps its default), which a DCHECK build accepts.
//
// Summary (summary.txt):
//   "c32 stock trace:" with the switch off, how often each of the two waits c32
//   changes occurred in the window and for how long:
//     DescheduleUntilFinished   the WebGL command buffer was descheduled until the
//                               previous frame's fence completed (the slice only
//                               exists when it actually waited)
//     ApplyBackpressure         calls (one per presented frame) and ::Metal poll
//                               iterations; iterations - calls = the sleeps
//   and whether either wait shows. c32's description: if neither does, the patch
//   has nothing to act on (the decision on the patch is not this driver's).
//   "c32 traced on:" the same with the switch on.
//   "c32 A/B:" the median and range of the uncapped rate of each variant, every
//   run, how many launches it rests on, each variant against "off", and the
//   launch order. A difference is an indication only.
// Invalid runs: a launch after which the display was asleep or locked, during
// which a watched process (posix-kcc-flags.js: by default the llama-server) was
// above 2 GB, or that rendered no frames, is reported, not counted, and run
// again (up to 3 attempts).
// Exit: 0 every launch measured without a crash or DCHECK line; 1 otherwise;
// 2 usage.
'use strict';
const fs = require('fs');
const path = require('path');
const k = require('./posix-kcc-flags');

const FEATURE = 'KccMacFineGpuBackpressure';
const ALL_JS = `--js-flags=${k.KCC_ALL_JS_FLAGS}`;
const VARIANTS = {
  off: [],
  on: k.joinKccFeatures([FEATURE]),
  c32: k.joinKccFeatures([FEATURE]),
  'all-but-c32': [...k.joinKccFeatures(k.KCC_ALL_FEATURES.filter((f) => f !== FEATURE)), ALL_JS],
  all: [...k.joinKccFeatures(k.KCC_ALL_FEATURES), ALL_JS],
};

const median = (xs) => {
  const s = xs.map(Number).sort((p, q) => p - q);
  if (s.length === 0) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// The two waits in one traced result (mac-gpu-backpressure-test.js "trace").
function waits(trace) {
  const slice = (re) => {
    const key = Object.keys(trace.slices || {}).find((n) => re.test(n));
    return key ? trace.slices[key] : null;
  };
  const d = slice(/DescheduleUntilFinished$/);
  const calls = slice(/^CALayerTreeCoordinator::ApplyBackpressure$/);
  const metal = slice(/^CALayerTreeCoordinator::ApplyBackpressure::Metal$/);
  const work = slice(/^CommandBufferStub::PerformWork$/);
  const sleeps = calls && metal ? Math.max(0, metal.count - calls.count) : 0;
  return { d, calls, metal, work, sleeps, deschedules: d ? d.count : 0 };
}
const sliceDesc = (s) => (s
  ? `${s.count}x, total ${s.totalMs.toFixed(1)} ms, p50 ${Math.round(s.p50Us)} us, p90 ${Math.round(s.p90Us)} us, max ${Math.round(s.maxUs)} us`
  : 'none');
function waitsDesc(w, windowMs) {
  return `over ${(windowMs / 1000).toFixed(0)} s: DescheduleUntilFinished ${sliceDesc(w.d)}; ` +
    `ApplyBackpressure ${sliceDesc(w.calls)}, ::Metal iterations ${w.metal ? w.metal.count : 0} ` +
    `(${w.sleeps} sleeps); CommandBufferStub::PerformWork ${w.work ? w.work.count : 0}x`;
}

async function main(argv) {
  const a = k.parseArgs(argv, {
    variants: 'off,on', runs: '6', page: 'heavy', mode: 'webgl', iters: '256',
    'warmup-ms': '3000', 'window-ms': '5000', trace: 'yes', categories: 'gpu,cc,viz',
  });
  const variants = k.list(a.variants);
  if (!a.exe || !a.out || !['yes', 'no'].includes(a.trace) || !['heavy', 'frame-cap'].includes(a.page) ||
      variants.length === 0 || variants.some((v) => !VARIANTS[v])) {
    console.log('usage: node mac-run-gpu-backpressure.js --exe <electron> --out <dir> [--variants off,on|c32,all-but-c32,all] [--runs 6] ' +
      '[--page heavy|frame-cap] [--mode webgl|2d] [--iters 256] [--warmup-ms 3000] [--window-ms 5000] [--trace yes|no] [--categories gpu,cc,viz]');
    return 2;
  }
  k.keepAwake();
  fs.mkdirSync(a.out, { recursive: true });
  const pageDesc = a.page === 'frame-cap'
    ? `frame-cap.html (the gates' light page, busy 0, ${a.mode}), 640x480 window`
    : `mac-gpu-heavy.html (GPU-bound), iters ${a.iters}, 1280x720 window`;
  const say = k.makeSummary(path.join(a.out, 'summary.txt'),
    `c32 (${FEATURE}) A/B  ${k.stamp()}\nexe: ${a.exe}\n` +
    `page: ${pageDesc}; warm-up ${a['warmup-ms']} ms, window ${a['window-ms']} ms; ` +
    '--disable-frame-rate-limit --disable-gpu-vsync\n' +
    `variants: ${variants.map((v) => `${v} [${VARIANTS[v].join(' ') || 'no switch'}]`).join('; ')}\n` +
    `${k.machineNotes()}\n`);
  let bad = 0;

  // One measured launch, run again while it is invalid. Returns the counted
  // result ({ r, ... } or null when no attempt was valid).
  async function launch(variant, name, traced) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const tag = attempt > 1 ? `${name} (attempt ${attempt})` : name;
      const json = path.join(a.out, `${name}.json`);
      const log = path.join(a.out, `${name}.log`);
      if (attempt > 1) {
        if (fs.existsSync(json)) fs.renameSync(json, path.join(a.out, `${name}-try${attempt - 1}.json`));
        fs.renameSync(log, path.join(a.out, `${name}-try${attempt - 1}.log`));
      }
      fs.rmSync(json, { force: true });
      const tr = traced ? [`--kcc-trace=${path.join(a.out, `${name}.pftrace`)}`, `--kcc-trace-categories=${a.categories}`] : [];
      const code = await k.invokeElectron(a.exe, ['mac-gpu-backpressure-test.js', `--kcc-out=${json}`,
        `--kcc-page=${a.page}`, `--kcc-mode=${a.mode}`, `--kcc-iters=${a.iters}`,
        `--kcc-warmup-ms=${a['warmup-ms']}`, `--kcc-window-ms=${a['window-ms']}`, ...tr, ...VARIANTS[variant], '--enable-logging'], log, { note: say });
      const r = k.readJson(json);
      const crash = k.crashLines(log);
      const frames = r && r.page ? r.page.frames : 0;
      const why = crash.length ? null : (k.displayInvalid() || (frames > 1 ? null : 'no frames rendered'));
      let line = `${tag.padEnd(22)} exit ${code}  ` + (r && r.page && r.page.fps
        ? `${r.page.fps.toFixed(1)} fps (${frames} frames; frame p50 ${k.fix(r.page.frameMs.p50, 2)} p99 ${k.fix(r.page.frameMs.p99, 2)} ms; 1% low ${k.fix(r.page.low1PctFps, 1)} fps)  lost ${r.lost}`
        : 'no result');
      if (why) line += `\n    INVALID (${why}; display ${k.displayDesc(k.lastRunDisplay().after)}) - not counted`;
      for (const c of crash) line += `\n    LOG: ${c}`;
      say(line);
      if (why) continue;
      if (crash.length || code !== 0 || !r) { bad++; return null; }
      return { variant, name, r };
    }
    bad++;
    say(`  ${name}: no valid attempt in 3`);
    return null;
  }

  // ---- the traced launches: the stock trace first -----------------------------
  if (a.trace === 'yes') {
    const c32Variant = variants.find((v) => v === 'on' || v === 'c32');
    for (const v of ['off', c32Variant].filter((x) => x && variants.includes(x))) {
      const t = await launch(v, `trace-${v}`, true);
      if (!t || !t.r.trace) { say(`c32 traced ${v}: no trace`); continue; }
      const w = waits(t.r.trace);
      if (v === 'off') {
        const shows = [w.deschedules > 0 ? `the command buffer was descheduled ${w.deschedules} times` : null,
          w.sleeps > 0 ? `ApplyBackpressure slept ${w.sleeps} times` : null].filter(Boolean);
        say(`c32 stock trace: ${waitsDesc(w, Number(a['window-ms']))}`);
        say(`c32 stock trace: ${shows.length ? `wait seen: ${shows.join('; ')}` : 'NEITHER WAIT SEEN (c32 would have nothing to act on)'}` +
          `; renderer ${t.r.renderer}, canvas ${t.r.canvas.join('x')}, ${t.r.page.fps.toFixed(1)} fps while traced`);
      } else {
        say(`c32 traced on: ${waitsDesc(w, Number(a['window-ms']))}; ${t.r.page.fps.toFixed(1)} fps while traced`);
      }
    }
  }

  // ---- untraced launches, the order rotated by one place every round ----------
  const rates = Object.fromEntries(variants.map((v) => [v, []]));
  const order = [];
  for (let i = 1; i <= Number(a.runs); i++) {
    const r = (i - 1) % variants.length;
    const round = [...variants.slice(r), ...variants.slice(0, r)];
    order.push(round.join(','));
    for (const v of round) {
      const t = await launch(v, `${v}-${i}`, false);
      if (t) rates[v].push(t.r.page.fps);
    }
  }
  const each = (xs) => xs.map((x) => x.toFixed(1)).join(' / ');
  const mo = median(rates.off || []);
  for (const v of variants) {
    const xs = rates[v];
    const m = median(xs);
    const vsOff = v !== 'off' && Number.isFinite(mo) && Number.isFinite(m) ? `; vs off ${(((m / mo) - 1) * 100).toFixed(1)} %` : '';
    say(`c32 A/B: ${v.padEnd(11)} median ${k.fix(m, 1)} fps, range ${xs.length ? `${Math.min(...xs).toFixed(1)}-${Math.max(...xs).toFixed(1)}` : 'n/a'} ` +
      `over ${xs.length} launches [${each(xs)}]${vsOff}`);
  }
  say(`c32 A/B: launch order by round: ${order.map((o, i) => `${i + 1}: ${o}`).join(' | ')} (an indication only)`);
  say(`c32 driver: ${bad ? `${bad} launch(es) without a valid result or with a crash/DCHECK` : 'every launch measured, no crash or DCHECK line'}`);
  say(`c32 ${k.watchSummary(a.out)}`);
  return bad ? 1 : 0;
}

if (require.main === module) k.runMain(main);
module.exports = { main };
