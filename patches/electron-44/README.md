# Chromium 152 patch set (Electron 44.x)

These are the four patches from [`patches/`](../) re-anchored against Chromium
**152.0.7977.54** and Electron **v44.0.0**. All four differ from their Chromium 150
counterparts, and the 150 versions reject on 152 — use the set that matches your target.

| File | Apply from |
|---|---|
| `ws-priority-patch.diff` | Chromium `src` root |
| `frame-pacing-patch.diff` | Chromium `src` root |
| `frame-cap-patch.diff` | Chromium `src` root |
| `frame-cap-electron-patch.diff` | `src/electron` |

There is no macOS GPU-crash guard here. The unguarded
`external_begin_frame_source()->DidReceiveNewCALayerParams()` deref exists in
`branch-heads/7871` only. Upstream `f0d1fd614eefb` did not add a null check — it moved the
DisplayLink switch into `ExternalBeginFrameSourceMojoMac` and deleted the call site, so on
152 there is nothing left to guard and
[`../macos-gpu-crash-patch.diff`](../macos-gpu-crash-patch.diff) will reject. That patch is
still required for Electron 43.x macOS builds.

## Why these differ from the Chromium 150 set

One substantive port decision, the rest context re-anchors. Recorded here because the next
milestone bump will hit the same places.

**The port decision.** `Display::DisableSwapUntilResize()` was deleted upstream (present in
151.0.7900, gone by 152.0.7938) along with `swapped_since_resize_`. That was where the
frame cap flushed its pending swap-ack delay. The flush moved into
`Display::ForceImmediateDrawAndSwapIfPossible()`, now the only caller of
`scheduler_->ForceImmediateSwapIfPossible()`. It still runs **before** the forced swap, for
the same load-bearing reason as in the 150 patch: `AttemptDrawAndSwap()` gates on
`pending_swaps_ < MaxPendingSwaps(args)`, so an ack held back by the cap would turn the
forced swap into a silent no-op.

**Context re-anchors.**

- `const int kMaxPendingSubmitFrames` became `constexpr int`, with a new
  `kFrameThrottlingSlackFactor` beside it.
- `class DisplayScheduler::BeginFrameObserver` moved from the `.cc` into the header's
  `protected:` section.
- The `DisplayScheduler` ctor init list and member block gained
  `allow_multiple_swaps_per_vsync_` and `use_platform_preferred_deadlines_` exactly where
  `cap_interval_` is inserted. The frame-cap members are declared **after** both, so
  member-init order still matches declaration order — otherwise `-Wreorder`.
- `MaxPendingSwaps()` split into `MaxPendingSwapsForRefreshRate` /
  `MaxPendingSwapsForDeadline` / `MaxPendingSwaps(const BeginFrameArgs&)`, and
  `current_frame_display_time()` gained an args parameter.
- Electron v44 added `#include "components/prefs/scoped_user_pref_update.h"` to
  `electron_api_base_window.cc`.

## Watch this on the next bump

`MaxPendingSwapsForDeadline` is a **new** path by which max-pending-swaps can exceed 1. If
it ever fires, the frame cap loosens and measured FPS reads high. It does not fire on 152:
`kAllowMultipleSwapsPerVsync` is `FEATURE_DISABLED_BY_DEFAULT`, and
`BackToBackBeginFrameSource::OnTimerTick()` builds `BeginFrameArgs` with no
`possible_deadlines`, so `MaxPendingSwaps(args)` falls through to
`MaxPendingSwapsForRefreshRate()` — the same value the old parameterless `MaxPendingSwaps()`
returned. Confirm with the FPS harness rather than assuming it carried over.

## Verification

Applicability was checked with `git apply --check` against a tree built from
`branch-heads/7977` + Electron `v44.0.0`, and the three Chromium diffs were round-tripped
(apply to pristine → byte-identical to the reviewed result). The shipped v44.0.0 builds
compile and pass both gates — see [`BUILD-GUIDE.md`](../../BUILD-GUIDE.md) for the full
build and test procedure.
