# Chromium 156 patch set (Electron 45.4.1)

Patches for **Electron v45.4.1** (Chromium **156.0.8078.100**, V8 **15.6.75.57**, Node 24.22.3).

Eleven patches, in two kinds:

- **Ported** (group `ported`): the four patches every release since v43 has shipped (input
  priority, frame pacing, exact frame cap), re-anchored for 156. Same code as
  [`../electron-44/`](../electron-44/).
- **Kept from the 2026-11-20 performance series** (every other group): seven patches. The series
  was drafted as 19 patches, built and checked on Windows, macOS and Linux, and cut down on
  2026-11-26 to the ones whose benefit was measured or whose fix is visible to a player. What
  was removed, and why, is under [Removed on 2026-11-26](#removed-on-2026-11-26).

**The lean set has not been built as a set yet.** The eleven diffs are byte for byte the ones
that were built and checked inside the 22-patch series; no kept diff shares a file with a
removed one except c10, which is applied before the patch it shared a file with. The results
files describe the builds of the 22-patch series: [RESULTS.md](RESULTS.md) (Windows),
[RESULTS-macos.md](RESULTS-macos.md), [RESULTS-linux.md](RESULTS-linux.md).

Every behaviour change of the seven sits behind a `base::Feature` that is **off by default**, so
a build with the whole set applied behaves like a ported-only build until the client passes
`--enable-features`. The one exception is c10, an upstream back-port.

## Layout and applying

```
series.txt      order, checkout and group of every patch
apply.sh        applies / checks / reverses the series, or commits it patch by patch
refresh.sh      regenerates the diffs from those commits after a fix
chromium/       diffs for the Chromium src root
electron/       diffs for src/electron
```

No patch touches `src/v8` any more. A tree that still carries the removed V8 patch has to be
reset to its base before the set is applied.

From Git Bash on Windows, or a shell on Linux/macOS, with `<src>` the Chromium `src` directory
of a tree synced to Electron v45.4.1:

```sh
patches/electron-45/apply.sh <src> --check            # would everything apply? changes nothing
patches/electron-45/apply.sh <src> --group ported     # the four shipped patches only
patches/electron-45/apply.sh <src> --not-group ported # the other seven, on top
patches/electron-45/apply.sh <src> --reverse          # undo
```

`--group` and `--not-group` take comma-separated lists. `--check` tests against the committed
tree (HEAD), so checking a subset only passes when the patches it stacks on are already
committed: on a pristine tree `--check --not-group ported` reports c60 as a reject,
because it sits on c03. In a tree that already has the series committed, check against the
pristine base instead with `--check --base FILE`. FILE lists one `<checkout> <commit>` per
line, as in [`results/stage0/base-commits.txt`](results/stage0/base-commits.txt). The diffs are
then stacked on those commits, and the script also reports whether base plus diffs is exactly
the tree at HEAD, i.e. whether the diffs here are the code that was built. Order matters
inside the series: `03` → `60` stack on the same files.
Each diff starts with a long description (stock behaviour, what changes, risks, how to A/B);
read it before touching the patch.

To change a patch, apply with `--commit` instead: each patch becomes one local commit
(`kcc-series: <root>/<file>`), a fix is folded into its patch with `git commit --fixup` and
`GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>`, and `refresh.sh <src>` rewrites the
diffs here from the commits, keeping each description.

Do not re-run `e sync` / `gclient sync` after applying: it resets the checkouts.

## The series

| # | Patch | Switch (all default off) | OS | What it changes |
|---|---|---|---|---|
| **ported** | | | | |
| c01 | `ws-priority` | none (always on) | all | Input and compositor tasks capped at normal priority: no WebSocket starvation while shooting |
| c02 | `frame-pacing` | `CustomMaxPendingFrames:count/N` | all | Draw throttling stays on under `--disable-frame-rate-limit`; queue depth tunable |
| c03 | `frame-cap` | `CustomFrameCap:fps/N` | all | Exact FPS cap by pacing swap acks; runtime `DisplayPrivate.SetFrameCapInterval` |
| e01 | `frame-cap-set-frame-cap` | none | all | `win.setFrameCap(fps)` |
| **input** | | | | |
| c10 | `keyup-after-handled-keydown` | none (upstream back-port) | all | After Esc or a `preventDefault()`ed keybind, only that key's keyup is swallowed, not every keyup: no stuck movement keys |
| c11 | `pointer-lock-esc-cooldown` | `KccNoPointerLockEscCooldown` | all | Removes the 1.25 s refusal to re-lock after Esc |
| **render** | | | | |
| c20 | `skip-canvas-perf-sampling` | `KccSkipCanvasPerfSampling` | all | Blink's canvas metrics sampler (a heap-stats walk on every 100th frame) never runs |
| **gpu** | | | | |
| c31 | `cache-vsync-interval` | `KccCacheVsyncInterval[:refresh_ms/1000]` | Win | With `--disable-gpu-vsync`, the display-config query runs once a second instead of on every present |
| c32 | `mac-gpu-backpressure-poll` | `KccMacFineGpuBackpressure[:poll_us/250]` | mac | The two 1-2 ms polls the GPU main thread uses while waiting for the previous frame become 250 µs |
| **audio** | | | | |
| c40 | `audioparam-coalesce` | `KccAudioParamCoalesce` | all | A run of same-time `setTargetAtTime` events is kept at three events instead of growing without bound while the AudioContext is suspended |
| **framecap** | | | | |
| c60 | `frame-cap-precise-release` | `KccFrameCapPreciseRelease[:spin_us/200]` | Win | Under a cap the viz thread sleeps through the hold and is woken by a high-resolution timer, instead of spinning a core |

`c` = `chromium/`, `e` = `electron/`. The numbers are the ones the patches had in the 22-patch
series, so they are not consecutive.

### Everything on

```
--enable-features=KccNoPointerLockEscCooldown,KccSkipCanvasPerfSampling,KccCacheVsyncInterval,KccMacFineGpuBackpressure,KccAudioParamCoalesce,KccFrameCapPreciseRelease
```

A feature for another OS is simply unknown there and is ignored. Chromium keeps only the
**last** `--enable-features` switch on a command line, so the client must merge these with
`CustomFrameCap` / `CustomMaxPendingFrames` into one comma-separated value.

### Ungated

- **c10** is a straight back-port of upstream `b642cf8610` (landed ungated, 2026-11-17).

## What is known about each kept patch

| Patch | Measured | Not measured |
|---|---|---|
| c01-c03, e01 | Windows (RTX 5080): WebSocket p99 32 ms, none over 50 ms; caps 60/144/240 exact. macOS (M5): p99 19 to 21 ms, caps exact. Linux (RTX 5080, XWayland): p99 17.5 ms, caps exact; single messages over 50 ms in 5 of 16 runs, cause not established | The cause of the late messages on Linux |
| c10 | The keyup after a prevented key reaches the page on all three systems (stock: lost) | Real keyboards, IME |
| c11 | Re-lock about 45 ms after Esc succeeds with the switch, is refused without | A physical Esc key |
| c20 | Sampler slices 135 → 0 on the RTX 5080; the sampler cost 0.64 ms on every 100th frame in traces of the game | The effect on frame times in play |
| c31 | Vsync-interval calls 13,344 → 8 on the RTX 5080; about 30 µs each in traces, with spikes to 1.35 ms | The effect on frame times in play |
| c32 | On the M5, pages whose frames take under a millisecond run 2.7 to 2.8 times faster uncapped; +0.6 % on a GPU-bound page | Anything in the game; the CPU cost of four times as many wakeups |
| c40 | Batch time while suspended stays flat with the switch; stock grows 12 to 15 times | Whether the game reaches the suspended state |
| c60 | Viz thread at a 144 cap: 96.2 % → 0.6 % of a core on the RTX 5080. Frame-interval spread under a cap widens (sd 0.07 → 0.23 ms, p99 +0.3 ms at 240) | 8 kHz mice, long sessions |

**Nothing has been measured per switch in play.** One match with every switch of the 22-patch
series on against off gave 689 against 738 fps, inside that PC's launch-to-launch variation.
The measured gain in play comes from the build, not from a patch: the Krunker-trained profile
(see [`../../pgo/`](../../pgo/)) gave about +28 % in a match on Windows.

## What to know before trusting each kept patch

Highest risk first.

- **c60 precise release.** It sits on the frame cap's swap-ack ledger and the begin-frame
  source's GPU-busy latch, where a missed release or a begin frame that is never re-armed
  freezes the window. Re-run the frame-cap release gate with the flag on: cap accuracy at
  60/144/240, hide/show, resize, runtime `setFrameCap`, cap off, a second animating view, and
  a cap set above what the machine can reach. c60 is Windows-only. Its release is slightly
  *less* exact than stock (late by up to about 0.35 ms, never early); what it buys is the core.
  It has no backstop timer: a lost timer notification would hold the ack until a resize or cap
  change. It also changes what the viz thread does when the cap is *not* binding (it sleeps
  between swap and ack instead of spinning). Linux and macOS keep the spin. It is the largest
  patch (351 added lines over seven files) and the first to re-cut on a Chromium bump.
- **c40 AudioParam coalescing.** Deliberately narrow: only a run of `setTargetAtTime` events at
  one already-reached time, on a timeline that holds nothing else. It is not bit-identical to
  stock (float rounding, about 1e-6 on listener positions); the description lists the three
  ways it can differ. Stock only shows the decay on about 92% of suspend points, so "stock
  stayed flat" in one run proves nothing: resume and suspend again.
- **c32 macOS back-pressure.** Wakes the GPU process about four times as often while it waits
  for a frame. Not measured in the game.
- **c11 Esc cooldown.** Removes an anti-trap protection. Acceptable only because the client
  loads one site; it applies to every window in the process.

Low risk, small: c10, c20, c31.

## Removed on 2026-11-26

Eleven patches of the 22-patch series were removed. The rule: a patch stays if its benefit was
measured, or if it fixes something a player can see; a saving too small to measure in play does
not pay for re-applying a patch on every Chromium bump on three systems. "Not measured" below
means the saving was never measured, not that it was measured as zero. The diffs are in the
history of this directory.

| Patch | Switch | Why it was removed |
|---|---|---|
| c12 `pin-raw-pointer-lock` | `KccPinRawPointerLock` | Guards a downgrade the client already prevents (its preload adds `unadjustedMovement` to every request). The case did not occur in 13 minutes of recorded play |
| c13 `raw-input-keep-wheel-motion` | `KccRawInputKeepWheelMotion` | Correct but tiny: one packet of movement per wheel notch |
| c14 `raw-input-fast-path` | `KccRawInputFastPath` | Saving not measured, on a thread that is not the bottleneck, in the Windows mouse path |
| c15 `lean-locked-mouse-move` | `KccLeanLockedMouseMove` | Saving not measured |
| e10 `skip-unobserved-input-emits` | `KccSkipUnobservedInputEmits` | Saving not measured; browser process only |
| c21 `webgl-fast-api-calls` | none | 3.7 % on a synthetic loop of calls that are about 6 % of a frame in the game |
| v01 `cppgc-sweep-slice` | `--js-flags=--cppheap-max-incremental-sweep-duration-ms=N` | Slices shorten as set (5.4 → 1.6 ms), but the effect on frame times in play was never measured; the only V8 patch |
| c30 `label-textures-once` | `KccLabelTexturesOnce` | Saving not measured; GPU thread, not the bottleneck |
| c41 `hrtf-panner-krate-angles` | `KccHrtfPannerKRateAngles` | Audio thread; cannot move the frame rate; saving not measured |
| c50 `x11-allow-unredirect` | `KccX11AllowUnredirect` | Only the window hint could be checked; no effect was ever measured, and a Wayland desktop composites XWayland windows regardless |
| c51 `x11-raw-mouse` | `KccX11RawMouse` | Worked in an Xorg session with a virtual mouse after two fixes, but under XWayland the page received less movement than a physical mouse sent (1,514 against 1,807 counts, and 2,465 against 5,744). Cause not found. The largest Linux patch (about 300 lines over eight files) |

The test drivers and pages of the removed patches were removed with them.

## Findings that changed the plan

- **The frame cap burns a core today.** While it holds a swap ack, `BackToBackBeginFrameSource`
  keeps re-posting a zero-delay tick that is dropped for "GPU busy", so the viz thread never
  sleeps. Measured at a 144 cap: 96 % of a core on the RTX 5080. That accidental spin is also
  why the release is already on time. c60 removes the spin and keeps the timing with a
  high-resolution timer, at the cost of about 0.3 ms of spread.
- **Input under a cap is one to two cap periods old.** The finished frame sits in viz until the
  *next* ack release. Measured at a 144 cap, main-frame start to display draw: about one period
  with an idle page, about two with 3 ms of script per frame. The cause is in viz, **but c61's
  fix does not work** and c61 was dropped (see [Not in this set](#not-in-this-set)).
- **Linux has no raw mouse input in Chromium at all**, on X11 or Wayland. c51 added it for X11
  and was removed (above): it has to work under XWayland to be worth carrying.
- **The build profile matters more than any patch.** Electron's stock optimisation profile is
  recorded without WebGL; a Krunker-trained profile gave about +28 % in a match on Windows.
- **`performance.now()` precision, `desynchronized` canvases, raising thread priorities, socket
  tweaks:** ruled out in the survey; do not revisit without new evidence.

## Port notes for the four carried patches

Recorded because the next milestone bump will hit the same places.

- `ws-priority`, `frame-pacing`: unchanged from the 152 revision apart from offsets.
- `frame-cap`: `root_compositor_frame_sink_impl.h` re-anchored (upstream widened the guard after
  `ForceImmediateDrawAndSwapIfPossible()` from `IS_ANDROID` to `IS_ANDROID || IS_MAC`), and the
  duplicated `ack_release_timer_.SetTaskRunner(task_runner)` line is gone.
- `frame-cap-set-frame-cap`: Electron 45 rewrote the binding table to
  `.SetMethod<&BaseWindow::Fn>("name")`; the method body is unchanged.

## Watch on the next bump

- `kDisplaySchedulerAsClient` is still a live kill switch at 156 and is **deleted at 159**.
  156 is the last milestone where `--disable-features=DisplaySchedulerAsClient` works.
- At 160, `IsDrawThrottled()` gains a view-transition exemption (frame-pacing needs re-cutting)
  and Skia Graphite is on by default on Windows.
- At 160, upstream `b642cf8610` is in the tree: drop c10.
- `MaxPendingSwapsForDeadline` is still a path by which max-pending-swaps can exceed 1 and
  loosen the cap. It does not fire with `kAllowMultipleSwapsPerVsync` off; confirm with the cap
  gate rather than assuming.

## Not in this set

- **c61 `frame-cap-late-latch` (`KccFrameCapLateLatch`), dropped 2026-11-21 because its premise
  is false.**
  - **What it does:** under a cap, viz withholds BeginFrames from the renderer's frame sink
    until the swap ack is released, so that the renderer starts its frame at the release and
    the frame is drawn as soon as it arrives.
  - **Why that fails:** under `--disable-frame-rate-limit`, which c61 requires (it acts only on
    `BackToBackBeginFrameSource`), blink gives every renderer its own synthetic back-to-back
    BeginFrame source (`WidgetBase`, "In disable frame rate limit mode, also let the renderer
    tick as fast as it can"). Renderers therefore do not take their BeginFrames from viz.
    Each one starts its next frame when its previous frame is acked, which happens at the
    display draw at the release, and the one-frame queue stays.
  - **What was measured** on the Stage 2 build (2D page, 144 cap):
    - The hold fired on 558 of 570 BeginFrames while the renderer began 570 frames of its
      own.
    - Input age was 6.56 ms with the switch off and on; BeginImplFrame to DrawAndSwap was
      11.05 vs 10.99 ms.
    - The 240 cap read 238.7-239.4 fps with it, against 239.6-240.0 without.
  - **What a working late latch needs:** a different mechanism, for example holding the
    renderer's frame ack until the ack release, or making the renderer use viz BeginFrames
    while a cap is set. That is a redesign, not a fix. Details in [RESULTS.md](RESULTS.md).
- The eleven patches under [Removed on 2026-11-26](#removed-on-2026-11-26).
- Upstream fixes worth back-porting that did **not** apply at 156 and were not hand-ported:
  `ca682f9e3d` (X11: first wheel tick dropped after a device switch, common under XWayland) and
  `668d0e8473` (macOS: missing keyUp after a fullscreen transition).
- `GetRawInputBuffer` batching, a `SetMaximumFrameLatency(1)` patch, forcing the game canvas
  opaque, a larger WebGL colour-buffer pool: considered, not drafted.
- The Krunker-trained PGO profile is a build procedure, not a patch: see [`../../pgo/`](../../pgo/).

## Verification

- Baseline: Chromium `156.0.8078.100` with all 301 of Electron v45.4.1's Chromium patches and
  all 37 of its V8 patches applied (so the diffs match what a synced tree contains).
- In the 22-patch series, `apply.sh --check` passed for every patch in order on that baseline,
  and `apply.sh --commit` followed by `refresh.sh` reproduced every diff byte for byte
  (`refresh.sh` writes full blob ids, `--full-index`, so the output does not depend on the size
  of the repository).
- **Still to do for the lean set:** `apply.sh --check` for the eleven on the baseline, a build
  on each system, both release gates and the checks of the kept patches.
- Build and run results of the 22-patch series are in [RESULTS.md](RESULTS.md),
  [RESULTS-macos.md](RESULTS-macos.md) and [RESULTS-linux.md](RESULTS-linux.md).
