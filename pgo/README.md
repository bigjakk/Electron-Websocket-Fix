# Krunker-trained PGO profile

Electron 45 release builds are already compiled with a PGO profile
(`chrome_pgo_phase = 2`) that Electron collects from its own benchmark suite:
Speedometer 3, JetStream 2, MotionMark, Node loops, IPC and a WebSocket echo
(`src/electron/script/pgo/`). That suite has no WebGL game loop, no WebAudio
panner graph and no pointer-lock input, so the code Krunker spends its time in
(the WebGL bindings, the GPU-process command decoder, ANGLE, the cc/viz frame
path under `--disable-frame-rate-limit`) is laid out from benchmark counts, not
from a match.

There is a second reason to collect our own profile: a function only gets its
profile if its control-flow hash matches the one recorded. Every function our
patches change no longer matches Electron's published profile and is compiled
without one. Collecting on the patched tree restores them.

This is a build-level change. It costs one extra (instrumented, non-LTO) build
plus a training session **per OS**, and the training needs a real GPU session
with a person playing. Nothing here has been run yet; expect a few percent on
the engine side, not more, because most of a Krunker frame is JIT-compiled
JavaScript that PGO cannot touch.

## Step 0: is it worth it? (2 minutes, no build)

Look at what the shipped profile knows about the GPU-process hot path. From the
Chromium `src` root of a synced 45.4.1 tree:

```sh
python3 tools/clang/scripts/update.py --package=coverage_tools \
    --output-dir=third_party/llvm-coverage-tools
third_party/llvm-coverage-tools/bin/llvm-profdata show --counts \
    --function=DoDrawElements electron/build/pgo_profiles/electron-win-x64-*.profdata
```

`coverage_tools` must go in its own directory: extracting it over
`third_party/llvm-build` replaces clang. If `DoDrawElements`,
`DoBindVertexArray` and friends show zero or near-zero counts, the suite never
trained them and the Krunker profile has something to add.

## Step 1: instrumented build of the patched tree

Apply the full patch set first (same tree, same patches as the release build).
Then, in a second output directory:

```gn
# out/Instrumented/args.gn
import("//electron/build/args/pgo-instrument.gn")
use_remoteexec = false
use_reclient = false
```

```sh
gn gen out/Instrumented
ninja -C out/Instrumented electron
```

`pgo-instrument.gn` sets `chrome_pgo_phase = 1`, turns ThinLTO off and drops
symbols, so this build links much faster than the release one. The binary runs
at about half speed and must never be shipped.

## Step 2: collect the base profile (automated, 30-60 minutes)

Electron's suite, on the instrumented build:

```sh
node electron/script/pgo/collect-profile.js \
    --electron out/Instrumented/electron.exe \
    --output out/Instrumented/base.profdata
```

On Linux run it under a display (`xvfb-run -a -s "-screen 0 1280x1024x24" node ...`).
If this step is skipped, use Electron's published profile for the target
(`electron/build/pgo_profiles/electron-<os>-<arch>-*.profdata`) as the base
instead; the merge still works, but the patched functions then get counts from
the Krunker session only.

## Step 3: collect the Krunker profile (a person plays, 15-20 minutes)

Run the instrumented build on the training harness in this directory (`<repo>` below is
wherever this repository is checked out), with the
**same** `--enable-features` list and `--js-flags` the shipped client will use,
so the trained paths are the patched ones.

Windows (PowerShell):

```powershell
$env:LLVM_PROFILE_FILE = "C:\pgo\krunker\kcc-%4m.profraw"
$env:KCC_PGO_FEATURES  = "<the client's enable-features list>"
$env:KCC_PGO_JS_FLAGS  = "<the client's js-flags, if any>"
$env:KCC_PGO_FRAME_CAP = "240"
& out\Instrumented\electron.exe <repo>\pgo\krunker-train
```

Linux:

```sh
LLVM_PROFILE_FILE="$HOME/pgo/krunker/kcc-%4m.profraw" \
KCC_PGO_FEATURES="<list>" KCC_PGO_FRAME_CAP=240 \
out/Instrumented/electron <repo>/pgo/krunker-train
```

macOS (continuous mode, one file per process; pool files crash renderers there):

```sh
LLVM_PROFILE_FILE="$HOME/pgo/krunker/kcc-%c%p.profraw" \
KCC_PGO_FEATURES="<list>" KCC_PGO_FRAME_CAP=240 \
out/Instrumented/Electron.app/Contents/MacOS/Electron <repo>/pgo/krunker-train
```

What to do in the session:

- Play real public matches on two or three different maps, uncapped, for at
  least ten minutes. Shoot, move, die, respawn, open the scoreboard and menus.
- Press **F9** and play a few more minutes with the frame cap on.
- Quit with **F10** or by closing the window, and wait for every Electron
  process to exit. A killed process writes nothing.

Running the real client instead of the harness is better still, because its
preload scripts and settings then shape the profile: point KCC at the
instrumented build (its `KCC_ELECTRON_DIR` local-install escape) with
`LLVM_PROFILE_FILE` set, and quit it cleanly.

## Step 4: merge

```sh
python3 pgo/merge-profiles.py \
    --llvm-profdata <src>/third_party/llvm-coverage-tools/bin/llvm-profdata \
    --base <src>/out/Instrumented/base.profdata \
    --krunker <the directory of .profraw files> \
    --output <src>/electron/build/pgo_profiles/kcc-win-x64.profdata
```

The script scales the Krunker counts so the session carries the same total
weight as the base suite (`--ratio 1.0`). Raise the ratio to lean harder on
Krunker; `--weight N` sets the multiplier directly.

## Step 5: release build with the merged profile

Add one line to the release `args.gn` and rebuild:

```gn
import("//electron/build/args/release.gn")
is_official_build = true
use_remoteexec = false
use_reclient = false
pgo_data_path = "//electron/build/pgo_profiles/kcc-win-x64.profdata"
```

An explicit `pgo_data_path` takes precedence over Electron's state-file lookup.
A profile is only valid for the OS and CPU it was collected on, and only for
the patch set it was collected with: after changing a patch, the functions it
touches lose their profile until the collection is repeated.

## Measuring

A/B the PGO build against the same patch set built with Electron's stock
profile, on the same machine, same map, same settings: average FPS, 1% and
0.1% lows over at least three runs each. If the difference is inside the
run-to-run spread, drop this step from the release process; it is the most
expensive item in the set to keep up.

## Platform notes

- **Windows** is where this pays: it is the primary platform and the one with
  a GPU session to play on.
- **Linux**: training needs a real GPU (not WSLg, not Xvfb) for the Krunker
  half. Without one, re-collect only the base suite on the patched build so
  patched functions keep a profile.
- **macOS** (24 GB build host): the instrumented build is non-LTO and lighter
  than the release link. Use the `%c%p` pattern above.
