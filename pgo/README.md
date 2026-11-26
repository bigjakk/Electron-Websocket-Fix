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
with a person playing.

**State (2026-11-24, Windows):** every step is done for the 22-patch tree.
The series was cut to 11 patches on 2026-11-26 (see
`patches/electron-45/README.md`). The recordings below were made on the
22-patch build. A profile only carries over to a function whose code is
unchanged, so in a build of the 11-patch tree the functions that the removed
patches touched fall back to the stock profile's counts; everything else
keeps the recorded ones. No recording has been made on the 11-patch tree.
Two recordings were played on the gaming PC (7.5 minutes on the ordinary
pointer lock, then 5.5 minutes with raw mouse input; 13 minutes and 10.6
million WebGL draw calls together) and merged with Electron's stock profile at
equal weight. In the merged profile 265 of the passthrough decoder's 829
functions and 621 of `WebGLRenderingContextBase`'s 1,162 have counts; in the
stock profile none do. The release build with that profile was built on
2026-11-24. **On the game's menu it runs 16 % and 22 % faster than the same
patches built with the stock profile** (two series of alternating launches,
[Measuring](#measuring)). **In play it runs 28.5 % faster**, with 1 % lows
25 % higher (three launches each, a person playing, raw mouse input on). Three
launches a side on maps that were not recorded is a first figure. Both release
gates pass on it, with the switches off and on. PGO cannot
touch JIT-compiled JavaScript, so the gain comes from the native part of a
frame (WebGL bindings, the command decoder, the compositor, V8's runtime).

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
trained them and the Krunker profile has something to add. `--function`
matches a substring of the symbol name (on Windows the decorated name, such as
`?DoDrawElements@GLES2DecoderPassthroughImpl@gles2@gpu@@...`), and this kind of
profile has no "Function count" line: read the `Block counts`.

Result for 45.4.1 (`electron-win-x64-1794713269-6bfc23bf15.profdata`, 1,065,314
functions): **no counts at all** for the passthrough command decoder (836
functions), the validating decoder (729), blink's `WebGLRenderingContextBase`
(1,322), `RasterDecoderImpl` (134) or `SkiaRenderer`. `SoftwareRenderer`'s
`SwapBuffers` has 17,432. Electron records its profile on the software
compositor with no WebGL, so the release build lays out the whole WebGL and
GPU path without a profile.

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
symbols. The binary runs at about half speed and must never be shipped.

- If `src/electron` carries local commits, add the same
  `override_electron_version = "45.4.1"` the release `args.gn` has.
- It is a full compile: 11 h 47 min on the build VM, the same pace as the
  release build. Only the link is faster (30 s against 21.7 min).
  `electron.exe` is 640 MB and the dist zip 317 MB.
- The build runs its own instrumented tools (mksnapshot and others), which
  leave `default_<signature>_0.profraw` files in `out/Instrumented`. They are
  not in the dist zip. Never merge them into a training profile.

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

To run it away from the Chromium tree, take the whole `electron/script/pgo/`
directory with its `node_modules`, plus Node and git: it fetches Speedometer,
JetStream and MotionMark from GitHub. Pass `--no-merge` there and merge on the
build machine. **On Windows, never run it from an elevated prompt:** it then
installs a certificate authority it generated ("Electron PGO Ephemeral CA")
into the machine's trusted roots and never removes it. Not elevated, it falls
back to plain HTTP.

## Step 3: collect the Krunker profile (a person plays, 15-20 minutes)

Run the instrumented build on the training harness in this directory (`<repo>` below is
wherever this repository is checked out), with the
**same** `--enable-features` list and `--js-flags` the shipped client will use,
so the trained paths are the patched ones.

Windows (PowerShell), with the script that sets all of this, waits for every
process to exit and checks the files:

```powershell
<repo>\pgo\record-krunker.ps1 -Exe <unpacked instrumented dist>\electron.exe `
    -OutDir C:\pgo\krunker-1 -ProfileDir C:\pgo\browser-profile `
    -LlvmProfdata <src>\third_party\llvm-coverage-tools\bin\llvm-profdata.exe
```

It passes every switch of the series (`test/kcc-flags.ps1`); the harness adds
the switches the client ships with and, on Windows, asks for raw mouse
movement as the client does by default (`krunker-train/preload.js`). The check
at the end prints how many raw mouse packets the browser handled and how often
it re-centred the cursor; a recording with no raw packets trained the ordinary
pointer lock, which the client does not use (`-NoRawInput` records that on
purpose). By hand, the same thing is:

```powershell
$env:LLVM_PROFILE_FILE = "C:\pgo\krunker-1\kcc-%4m.profraw"
$env:KCC_PGO_FEATURES  = "<the client's enable-features list>"
$env:KCC_PGO_JS_FLAGS  = "<the client's js-flags, if any>"
$env:KCC_PGO_FRAME_CAP = "240"
& <unpacked instrumented dist>\electron.exe <repo>\pgo\krunker-train
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

How the files are written (checked on the 45.4.1 instrumented build):

- Only the browser process uses the `LLVM_PROFILE_FILE` name
  (`kcc-<signature>_0.profraw`), and it writes at exit. Every child process
  (renderer, GPU, network service) writes `child_pool-<0..3>.profraw` in the
  same directory. Two children can share a file; their counts add up. A
  child's file is created empty when the process starts.
- The files are opened in merge mode. **Use a new, empty directory for each
  recording.**
- `app.quit()` and closing the last window flush every child (3 runs of 3
  each): Electron asks the children to dump and waits. `app.exit()` lost the
  renderer's counts in 3 runs of 3. Keep `app.exit()` and `process.exit()` out
  of whatever is recorded.
- **Never dump the counters mid-session** (the DevTools method
  `NativeProfiling.dumpProfilingDataOfAllProcesses` exists in this build): a
  process writes once, and everything it runs after the dump is lost.

A one-minute test on the game's menu (RTX 5080 PC, 2026-11-22) wrote 515 MB in
three files: 733,083 WebGL draw calls counted in the renderer, 733,040 in the
GPU process's decoder, where the stock profile has none.

Running the real client instead of the harness is better still, because its
preload scripts and settings then shape the profile: run KCC from source on
the instrumented `electron.exe` with `LLVM_PROFILE_FILE` set and its own
`--user-data-dir`, and quit it cleanly (it quits with `app.quit()`).

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

Notes from the 45.4.1 build (2026-11-23 to 24, build VM):

- Every target is compiled with the profile, so this is a full compile even
  next to a finished release build: 12 h 30 min for 46,706 steps in a new
  output directory (`out/ReleasePgo`), against 11 h 55 min for the release
  build.
- A second release-sized output directory needs about 55 GB: free space fell
  from 63 GiB to 8.4 GiB during the `electron.exe` link (ThinLTO cache and a
  4.3 GB PDB) and ended at 23 GiB. Building in place in `out/Release` instead
  replaces the stock-profile build.
- To check that the profile is the one in use, read a compile command
  (`ninja -C out/ReleasePgo -t commands obj/base/base/base64.obj`): it carries
  `-fprofile-use=../../electron/build/pgo_profiles/kcc-win-x64.profdata`.
  The build itself says nothing either way: Chromium passes
  `-Wno-profile-instr-unprofiled -Wno-profile-instr-out-of-date`, so functions
  without a profile, or whose profile no longer matches, are compiled silently.
- V8's built-ins keep Electron's stock profile
  (`electron-v8-builtins.profile`); mksnapshot prints the same 121
  `Rejected profile data for <builtin>` lines in both builds.
- `electron.exe` is 255,829,504 bytes against 249,946,624 (+2.4 %), the dist
  zip 162,337,280 against 158,245,796. Five DLLs grow by 19 to 50 KB; the
  other 67 files keep their size.

## Measuring

A/B the PGO build against the same patch set built with Electron's stock
profile, on the same machine, same map, same settings: average FPS, 1% and
0.1% lows over at least three runs each. If the difference is inside the
run-to-run spread, drop this step from the release process; it is the most
expensive item in the set to keep up.

`test/run-ab-launches.ps1` runs two builds alternately over several launches
and prints each launch, the difference and a permutation test. With
`-Scene menu` nobody has to play: each launch sits on the game's menu, which
draws a live match from a fixed camera.

```powershell
<repo>\test\run-ab-launches.ps1 -ExeA <stock-profile dist>\electron.exe `
    -ExeB <PGO dist>\electron.exe -LabelA base -LabelB pgo -Launches 8 `
    -ProfileDir C:\pgo\ab-browser-profile -OutDir C:\pgo\ab-menu-1
```

Result on the gaming PC, 2026-11-24 (RTX 5080, desktop locked, every switch
on, one minute per launch with the first 20 s left out):

| Frames per second, per launch | Stock profile | Krunker profile |
|---|---|---|
| Series 1 | 582-691, mean 638 (8 launches) | 706-838, mean 743 (7) |
| Series 2 | 596-718, mean 673 (8) | 730-897, mean 822 (7) |

Every launch of the PGO build is faster than every launch of the other:
+16.5 % and +22.3 % on the means, +13 % to +25 % map by map in series 2. The
details and the limits are in `patches/electron-45/RESULTS.md`. Two things to
know before repeating it:

- The map differs from launch to launch. The script saves a picture of each
  launch's last frame; compare launches on the same map.
- A launch can stop at the site's "Verify you are human" check and draw no 3D
  scene (about 1,700 fps here). It happened in one launch of each series.
  Leave those out (`-SummaryOnly -Exclude <label>`), never answer the check
  from a script, and keep series short and rare.

A menu is not a match: the figure that decides whether this step stays is the
one from play, with `-Scene match -Minutes 0` and a person playing the same
thing in every launch (F10 ends a launch). Write down the map and mode of each
launch; the script saves no picture in a match.

Result on the gaming PC, 2026-11-24 (desktop unlocked, fullscreen, every
switch on, no frame cap, raw mouse input, 1.4 to 2.6 minutes with the pointer
locked per launch, order A B B A A B):

| Per launch, in a match | Stock profile | Krunker profile |
|---|---|---|
| Frames per second | 418, 473, 467 | 533, 626, 587 |
| 1 % low | 196, 204, 213 | 244, 270, 250 |
| 0.1 % low | 112, 121, 116 | 135, 147, 143 |
| Frames over 8 ms, per minute | 31, 28, 31 | 24, 22, 23 |

+28.5 % on the means, and the two ranges do not overlap, so the difference is
outside the launch-to-launch spread. Its limits: three launches a side (the
permutation test cannot go below 10 % with that few), and the map and mode of
each launch were not recorded.

## Platform notes

- **Windows** is where this pays: it is the primary platform and the one with
  a GPU session to play on.
- **Linux**: training needs a real GPU (not WSLg, not Xvfb) for the Krunker
  half. Without one, re-collect only the base suite on the patched build so
  patched functions keep a profile.
- **macOS** (24 GB build host): the instrumented build is non-LTO and lighter
  than the release link. Use the `%c%p` pattern above.
