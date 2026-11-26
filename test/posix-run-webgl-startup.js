// Repeats webgl-startup-test.js with every switch off and with every switch on
// (the frame-cap gate's "all"), interleaved, and counts the launches whose
// WebGL2 context did not survive startup. The Node port of run-webgl-startup.ps1
// for macOS and Linux. webgl-startup-test.js itself runs with
// --disable-frame-rate-limit and --disable-gpu-vsync, as the gates do (the 43.x
// builds crashed the GPU process there on macOS).
//
//   node posix-run-webgl-startup.js --exe <electron> --out <dir> [--runs 60] [--variants off,all]
//                             [--extra-args '--enable-logging']
//
// Variants (comma-separated): off; all (every switch, as the gates use it);
// features (every --enable-features switch, no JS flag); js (only the JS flag);
// a feature name or names joined by + (KccA+KccB: those features alone).
// --extra-args: Electron switches for every launch, space-separated.
'use strict';
const fs = require('fs');
const path = require('path');
const k = require('./posix-kcc-flags');

async function main(argv) {
  const a = k.parseArgs(argv, { runs: '60', variants: 'off,all', 'extra-args': '--enable-logging' });
  if (!a.exe || !a.out) {
    console.log('usage: node posix-run-webgl-startup.js --exe <electron> --out <dir> [--runs 60] [--variants off,all] [--extra-args ...]');
    return 2;
  }
  const byVariant = {};
  for (const v of k.list(a.variants)) {
    if (v === 'off') byVariant[v] = [];
    else if (v === 'all') byVariant[v] = [...k.joinKccFeatures(k.KCC_ALL_FEATURES), `--js-flags=${k.KCC_ALL_JS_FLAGS}`];
    else if (v === 'features') byVariant[v] = k.joinKccFeatures(k.KCC_ALL_FEATURES);
    else if (v === 'js') byVariant[v] = [`--js-flags=${k.KCC_ALL_JS_FLAGS}`];
    else if (/^Kcc/.test(v)) byVariant[v] = k.joinKccFeatures(v.split('+'));
    else throw new Error(`unknown variant ${v}`);
  }
  const extra = String(a['extra-args']).split(' ').filter(Boolean);
  const runs = Number(a.runs);
  k.keepAwake();
  fs.mkdirSync(a.out, { recursive: true });
  const note = k.makeSummary(path.join(a.out, 'summary.txt'),
    `# ${k.stamp()}  ${a.exe}  ${runs} runs per variant, interleaved\n# ${k.machineNotes()}`);
  const tally = {};
  for (const v of Object.keys(byVariant)) tally[v] = { runs: 0, bad: 0, lost: 0, crash: 0, rates: [] };
  for (let i = 1; i <= runs; i++) {
    for (const v of Object.keys(byVariant)) {
      const json = path.join(a.out, `${v}-${i}.json`);
      const log = path.join(a.out, `${v}-${i}.log`);
      fs.rmSync(json, { force: true });
      const code = await k.invokeElectron(a.exe, ['webgl-startup-test.js', `--kcc-out=${json}`, ...byVariant[v], ...extra], log);
      const r = k.readJson(json);
      const crash = k.crashCount(log);
      const t = tally[v];
      t.runs++;
      if (code !== 0 || !r) t.bad++;
      if (crash) t.crash++;
      const lost = !!(r && r.page && (r.page.lost || !r.page.hasGl || (r.consoleLost || []).length > 0));
      if (lost) t.lost++;
      if (r && r.page) t.rates.push(Number(r.page.rafPerSec));
      const desc = r && r.page
        ? `gl ${r.page.hasGl}  lost ${r.page.lost}  rAF ${r.page.rafPerSec}/s  console-lost ${(r.consoleLost || []).length}  events ${(r.events || []).length}`
        : 'no result';
      note(`${`${v}-${i}`.padEnd(8)} exit ${code}  ${desc}${crash ? `  CRASH LINES ${crash}` : ''}`);
    }
  }
  let ok = true;
  for (const v of Object.keys(byVariant)) {
    const t = tally[v];
    const s = [...t.rates].sort((p, q) => p - q);
    const min = s.length ? s[0] : 'n/a';
    const med = s.length ? s[Math.floor(s.length / 2)] : 'n/a';
    if (t.lost || t.bad || t.crash) ok = false;
    note(`${v.padEnd(4)} ${t.runs} runs: context lost ${t.lost}, failed ${t.bad}, crash lines ${t.crash}; rAF/s min ${min} median ${med}`);
  }
  return ok ? 0 : 1;
}

if (require.main === module) k.runMain(main);
module.exports = { main };
