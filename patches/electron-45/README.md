# Chromium 156 patch set (Electron 45.4.1)

Patches for **Electron v45.4.1** (Chromium **156.0.8078.100**, V8 **15.6.75.57**, Node 24.22.3).

Two kinds of patch live here, and they are not equally trustworthy:

- **Ported** (group `ported`): the four patches every release since v43 has shipped (input
  priority, frame pacing, exact frame cap), re-anchored for 156. Same code as
  [`../electron-44/`](../electron-44/).
- **Drafted** (every other group): new patches from the 2026-11-20 performance survey,
  written against the real 156 source. On Windows every draft compiled as written (no fix
  was needed), and each was run against a synthetic check and both release gates on a
  machine **without a GPU**: see [RESULTS.md](RESULTS.md). One draft, c61, was dropped after
  its check (see [Not in this set](#not-in-this-set)). The macOS and Linux drafts (c32, c50,
  c51) have still never been compiled. **None has been tested in the game.** Treat every
  number in a patch description as an estimate until it is measured on a real machine.

Every drafted behaviour change sits behind a `base::Feature` that is **off by default**, so a
build with the whole series applied behaves like a ported-only build until the client passes
`--enable-features`. The exceptions are listed under [Ungated](#ungated).

## Layout and applying

```
series.txt      order, checkout and group of every patch
apply.sh        applies / checks / reverses the series, or commits it patch by patch
refresh.sh      regenerates the diffs from those commits after a fix
chromium/       diffs for the Chromium src root
electron/       diffs for src/electron
v8/             diffs for src/v8
```

From Git Bash on Windows, or a shell on Linux/macOS, with `<src>` the Chromium `src` directory
of a tree synced to Electron v45.4.1:

```sh
patches/electron-45/apply.sh <src> --check            # would everything apply? changes nothing
patches/electron-45/apply.sh <src> --group ported     # the four shipped patches only
patches/electron-45/apply.sh <src> --not-group ported # the drafts, on top
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
inside the series:
`03` → `60` stack on the same files, as do `10` → `12`, `13` → `14` and `50` → `51`.
Each diff starts with a long description (stock behaviour, what changes, risks, how to A/B);
read it before touching the patch.

While the drafts are still being made to compile, apply with `--commit` instead: each patch
becomes one local commit (`kcc-series: <root>/<file>`), a fix is folded into its patch with
`git commit --fixup` and `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>`, and
`refresh.sh <src>` rewrites the diffs here from the commits, keeping each description.

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
| c12 | `pin-raw-pointer-lock` | `KccPinRawPointerLock` | Win, mac | A raw pointer lock stays raw when the page re-requests the lock without `unadjustedMovement` |
| c13 | `raw-input-keep-wheel-motion` | `KccRawInputKeepWheelMotion` | Win | Mouse movement that arrives in the same raw packet as a wheel tick is no longer dropped |
| c14 | `raw-input-fast-path` | `KccRawInputFastPath` | Win | One `GetRawInputData` call into a stack buffer; legacy `WM_MOUSEMOVE` dropped before an event is built |
| c15 | `lean-locked-mouse-move` | `KccLeanLockedMouseMove` | Win, mac | Raw mouse moves skip the input predictor and are dispatched with a one-entry coalesced list |
| e10 | `skip-unobserved-input-emits` | `KccSkipUnobservedInputEmits` | all | Electron stops emitting `before-mouse-event` / `input-event` to JS when nothing listens |
| **render** | | | | |
| c20 | `skip-canvas-perf-sampling` | `KccSkipCanvasPerfSampling` | all | Blink's canvas metrics sampler (a heap-stats walk on every 100th frame) never runs |
| c21 | `webgl-fast-api-calls` | none (build-time) | all | V8 fast API calls for `bindVertexArray`, `useProgram`, `activeTexture`, `enable`, `disable`, `drawArraysInstanced`, `drawElementsInstanced`, `vertexAttribDivisor` |
| v01 | `cppgc-sweep-slice` | `--js-flags=--cppheap-max-incremental-sweep-duration-ms=N` (default 5 = stock) | all | Main-thread Oilpan sweep slice after a major GC becomes tunable |
| **gpu** | | | | |
| c30 | `label-textures-once` | `KccLabelTexturesOnce` | all (pays on Win/D3D11) | `glObjectLabel` once per texture instead of on every bind |
| c31 | `cache-vsync-interval` | `KccCacheVsyncInterval[:refresh_ms/1000]` | Win | With `--disable-gpu-vsync`, the display-config query runs once a second instead of on every present |
| c32 | `mac-gpu-backpressure-poll` | `KccMacFineGpuBackpressure[:poll_us/250]` | mac | The two 1-2 ms polls the GPU main thread uses while waiting for the previous frame become 250 µs |
| **audio** | | | | |
| c40 | `audioparam-coalesce` | `KccAudioParamCoalesce` | all | A run of same-time `setTargetAtTime` events is kept at three events instead of growing without bound while the AudioContext is suspended |
| c41 | `hrtf-panner-krate-angles` | `KccHrtfPannerKRateAngles` | all | HRTF panners compute azimuth/elevation for 2 frames per quantum instead of 128 (bit-identical output) |
| **linux** | | | | |
| c50 | `x11-allow-unredirect` | `KccX11AllowUnredirect` | Linux/X11 | `_NET_WM_BYPASS_COMPOSITOR` 2 → 1 on ordinary top-level windows, so the compositor may unredirect the game |
| c51 | `x11-raw-mouse` | `KccX11RawMouse` | Linux/X11 | `requestPointerLock({unadjustedMovement:true})` works, fed by XInput2 raw motion |
| **framecap** | | | | |
| c60 | `frame-cap-precise-release` | `KccFrameCapPreciseRelease[:spin_us/200]` | Win | Under a cap the viz thread sleeps through the hold and is woken by a high-resolution timer, instead of spinning a core |

`c` = `chromium/`, `e` = `electron/`, `v` = `v8/`.

### Everything on

```
--enable-features=KccNoPointerLockEscCooldown,KccPinRawPointerLock,KccRawInputKeepWheelMotion,KccRawInputFastPath,KccLeanLockedMouseMove,KccSkipUnobservedInputEmits,KccSkipCanvasPerfSampling,KccLabelTexturesOnce,KccCacheVsyncInterval,KccMacFineGpuBackpressure,KccAudioParamCoalesce,KccHrtfPannerKRateAngles,KccX11AllowUnredirect,KccX11RawMouse,KccFrameCapPreciseRelease
--js-flags=--cppheap-max-incremental-sweep-duration-ms=1
```

A feature for another OS is simply unknown there and is ignored. Chromium keeps only the
**last** `--enable-features` switch on a command line, so the client must merge these with
`CustomFrameCap` / `CustomMaxPendingFrames` into one comma-separated value. Ship them off and
turn them on one at a time: each exists to be A/B-tested on a real machine.

### Ungated

- **c10** is a straight back-port of upstream `b642cf8610` (landed ungated, 2026-11-17).
- **c21** changes generated bindings, so it cannot be switched at run time.
  `--js-flags=--no-turbo-fast-api-calls` turns off *all* fast API calls, which bounds its
  effect but does not isolate it.
- **v01** defaults to the stock 5 ms.
- **e10** leaves two small JS hooks running with the feature off (they only set a boolean).

## What to know before trusting each draft

Highest risk first.

- **c51 X11 raw mouse.** 295 added lines over eight files, the largest draft, and Linux-only,
  so nothing but a Linux build will tell whether it compiles (a desk-check against the tree
  found nothing that would fail, and one minor logic bug, recorded in its description). It changes sensitivity (movement
  becomes device counts, as on Windows). Raw motion is global on X11, so the patch forwards it
  only while the window holds the pointer capture **and** the input focus; keep that gate.
  Test: lock resolves instead of rejecting; summed `movementX` over a fixed swipe does not
  change with hand speed or with the desktop's pointer acceleration; alt-tab, Esc and XWayland.
- **c60 precise release.** It sits on the frame cap's swap-ack ledger and the begin-frame
  source's GPU-busy latch, where a missed release or a begin frame that is never re-armed
  freezes the window. Re-run the frame-cap release gate with the flag on: cap accuracy at
  60/144/240, hide/show, resize, runtime `setFrameCap`, cap off, a second animating view, and
  a cap set above what the machine can reach. (This passed on Windows, software compositing;
  see [RESULTS.md](RESULTS.md).) c60 is Windows-only. Its release is slightly *less* exact
  than today's (late by up to about 0.35 ms, never early); what it buys is the core. It has no
  backstop timer: a lost timer notification would hold the ack until a resize or cap change.
  Linux and macOS keep the spin.
- **c40 AudioParam coalescing.** Deliberately narrow: only a run of `setTargetAtTime` events at
  one already-reached time, on a timeline that holds nothing else. It is not bit-identical to
  stock (float rounding, about 1e-6 on listener positions); the description lists the three
  ways it can differ. Stock only shows the decay on about 92% of suspend points, so "stock
  stayed flat" in one run proves nothing: resume and suspend again.
- **c12 pin raw pointer lock.** Fixes a downgrade that does exist in the code, but nobody has
  confirmed that Krunker or the client triggers it. If logging `requestPointerLock` calls shows
  no option-less re-request, this patch is a no-op and the view snaps have another cause.
- **c32 macOS back-pressure.** Unmeasured. If a stock trace on the Mac shows neither
  `DescheduleUntilFinished` waits nor `CALayerTreeCoordinator::ApplyBackpressure`, drop it.
- **c11 Esc cooldown.** Removes an anti-trap protection. Acceptable only because the client
  loads one site; it applies to every window in the process.
- **c15 lean mouse move.** `getCoalescedEvents()` returns one entry and `getPredictedEvents()`
  none for raw moves. `movementX/Y` are unchanged (coalescing has already summed them).
- **e10** touches `lib/browser/api/web-contents.ts`, so the browser JS bundle must be rebuilt;
  a stale bundle leaves the events switched off whenever the feature is on.
- **c21** looked dangerous and is not: at 156 the "no allocation" in `[NoAllocDirectCall]` is
  historical (`IDLExtendedAttributes.md` says allocation, exceptions and re-entry are allowed).
- **c60** also changes what the viz thread does when the cap is *not* binding (it sleeps between
  swap and ack instead of spinning). Check uncapped FPS with a cap set far above what the
  machine can reach.

Low risk, small: c13, c14, c20, c30, c31, c41, c50, v01.

## Findings that changed the plan

- **The frame cap burns a core today.** While it holds a swap ack, `BackToBackBeginFrameSource`
  keeps re-posting a zero-delay tick that is dropped for "GPU busy", so the viz thread never
  sleeps. Estimated at roughly 75% of a core at a 240 cap; **measured** at 77-100% of a core
  at a 144 cap on the build machine (software compositing), and 11-33% with c60. That
  accidental spin is also why the release is already on time. c60 removes the spin and keeps
  the timing with a high-resolution timer.
- **Input under a cap is about one cap period old.** The finished frame sits in viz until the
  *next* ack release. Measured on the build machine at a 144 cap: main-frame start to display
  draw about 6.6 ms (0.95 periods) with an idle page, about 13.5 ms (two periods) with 3 ms
  of script per frame. The survey blamed `just_submitted_in_deadline` in cc's state machine;
  that is not involved. The cause is in viz, **but c61's fix does not work** and c61 was
  dropped (see [Not in this set](#not-in-this-set)).
- **Linux has no raw mouse input in Chromium at all**, on X11 or Wayland. c51 adds it for X11.
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
- `MaxPendingSwapsForDeadline` is still a path by which max-pending-swaps can exceed 1 and
  loosen the cap. It does not fire with `kAllowMultipleSwapsPerVsync` off; confirm with the cap
  gate rather than assuming.
- c21: if upstream annotates the same WebGL methods, drop the patch.
- c41: any new reader of `azimuth_values_` / `elevation_values_` breaks its bit-identity.

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
- Upstream fixes worth back-porting that did **not** apply at 156 and were not hand-ported:
  `ca682f9e3d` (X11: first wheel tick dropped after a device switch, common under XWayland) and
  `668d0e8473` (macOS: missing keyUp after a fullscreen transition).
- Wayland raw mouse: the client forces X11, so only the X11 path was drafted.
- `GetRawInputBuffer` batching, a `SetMaximumFrameLatency(1)` patch, forcing the game canvas
  opaque, a larger WebGL colour-buffer pool: considered, not drafted.
- The Krunker-trained PGO profile is a build procedure, not a patch: see [`../../pgo/`](../../pgo/).

## Verification

- Baseline: Chromium `156.0.8078.100` with all 301 of Electron v45.4.1's Chromium patches and
  all 37 of its V8 patches applied (so the diffs match what a synced tree contains).
- `apply.sh --check` passes for all 23 patches in order on that baseline.
- `apply.sh --commit` followed by `refresh.sh` reproduces every diff byte for byte. This was
  **not** true as first written: git abbreviates blob ids to a length that depends on the size
  of the repository, so every `index` line changed between the sparse checkout the drafts were
  written in and a full one. `refresh.sh` now writes full ids (`--full-index`); the diffs were
  rewritten once that way (content unchanged), and a second refresh reports nothing changed.
- The three ported Chromium diffs round-trip byte-identical to the reviewed port.
- Build and run results (Windows, DCHECK and official builds, no GPU) are in
  [RESULTS.md](RESULTS.md), with raw logs under [`results/`](results/).
