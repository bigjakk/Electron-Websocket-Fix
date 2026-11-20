# Electron v45.4.1 KCC series: build and check results

Build of Electron **v45.4.1** (Chromium **156.0.8078.100**, V8 **15.6.75.57**) with the patch
series in this directory, on the machine described below. Raw logs are in
[`results/`](results/). Nothing here was tested in the game; see
[What this machine could not check](#what-this-machine-could-not-check).

> Status: in progress. Sections marked _pending_ are filled in as the stages complete.

## Machine (Stage 0)

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 (build 26200), x64 |
| CPU | QEMU Virtual CPU version 2.5+, **12 cores / 12 threads** (the brief assumed 24) |
| RAM | 32.0 GB; commit limit 34.0 GB (2 GB system-managed pagefile) |
| Disk | C: **98.0 GB free** at the start (the brief asks for ~250 GB). Enough here only because the Chromium 156 checkout, its git cache and a 52 GB `out/Release` from the v45.0.0-alpha.14 build already existed in `C:\electron` |
| GPU | **None.** Display adapters: Microsoft Remote Display Adapter, Microsoft Basic Display Adapter. Chromium reports `gpu_compositing: disabled_software`; WebGL runs on ANGLE D3D11 over WARP (`Microsoft Basic Render Driver`, a software rasteriser) |
| Session | RDP session `rdp-tcp#0`, Active (rendering tests need an active session: with a disconnected one rAF never runs) |
| Toolchain | VS 2022 Build Tools (`C:\BuildTools`), depot_tools (python3 3.11.8), Node.js 24.15.0 (Electron 45 needs >= 22.18.0) |

Consequences of the missing GPU, which apply to every result below:

- The display compositor runs the **software** output path. Frame-cap pacing, swap-ack
  release and the begin-frame source are the same code as with a GPU, but the swap itself
  is a software present, and frame rates are far lower than on a gaming machine.
- `DCompPresenter` is not used, so **c31 cannot be exercised** here.
- WebGL is real ANGLE/D3D11 code on WARP, so c21 and c30 run their actual code paths, but
  performance numbers from WARP say nothing about a real GPU.

## Source tree (Stage 0)

Existing checkout `C:\electron` (gclient root, `src/electron` unmanaged), moved from
v45.0.0-alpha.14 (Chromium 156.0.8077.0) to the **v45.4.1** tag and synced with
`gclient sync --with_branch_heads --with_tags --reset`
([log](results/stage0/sync_4541.log); 1 h). The sync could not fetch into the
existing Chromium git cache (two failed `git fetch`, no reason printed), so gclient
re-bootstrapped the cache from Google Storage (14.4 GiB); the "STALL DETECTED" lines in
the log are gsutil progress that does not end in newlines, not a stall.

| Check | Result |
|---|---|
| `src/electron/DEPS` `chromium_version` | `156.0.8078.100` |
| `src/chrome/VERSION` | 156.0.8078.100 |
| V8 (`v8/include/v8-version.h`) | 15.6.75.57 |
| Electron's own patches | 301 Chromium commits on `46876a0c2d` (156.0.8078.100), 37 V8 commits on the pinned `5e51e9c607` |
| Windows SDK required (`build/toolchain/win/setup_toolchain.py`) | 10.0.28000.0, installed |
| Electron 45 build docs | Node.js >= 22.18.0, VS 2022; nothing stricter than BUILD-GUIDE.md otherwise |

Base commits the series was applied on ([`results/stage0/base-commits.txt`](results/stage0/base-commits.txt)):

| Checkout | Base commit |
|---|---|
| `src` | `8add51604cf1b2b144d0d431649229d8a3066a3b` |
| `src/electron` | `deaded07eebdfe9a3737884933b1acbe65971f64` (v45.4.1) |
| `src/v8` | `94a69781b2f5c673c6579713f09af4b86311ad64` |

`apply.sh --check`: 23 ok, 0 failed; `apply.sh --commit`: 23 commits
([logs](results/stage0/)).

**refresh.sh did not round-trip byte for byte** (the README claimed it did): in this full
checkout git abbreviates blob ids to 13 hex digits, in the sparse checkout the drafts were
written in to 9, so every `index` line differed although no diff content did.
`refresh.sh` now passes `--full-index`, the 23 diffs were rewritten once with full ids
(content unchanged), and a second refresh reports 0 changed.

## Build configurations

_pending_

## Release gates

_pending_

## Per patch

_pending_

## Dropped

_pending_

## What this machine could not check

_pending_
