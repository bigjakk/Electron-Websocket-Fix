# Synthetic checks for the drafted patches of the KCC Electron 45 series.
# Each check runs the same binary with the patch's switch off and on.
#
#   run-checks.ps1 -Exe <electron.exe> -OutDir <dir> [-Only c10,c11,raw,e10,c21,v01,c20,c40,c41,c60,lat]
#   ("raw" covers c12, c13, c14 and c15; "c20" also reports c30 and c31;
#    "lat" is informational: input age under a 144 cap, no switch. It is what
#    the c61 check measured before c61 was dropped; "c61" still runs that check
#    against a build that has KccFrameCapLateLatch.)
#
# Writes one log / JSON per run into -OutDir and a summary.txt. A check that
# cannot be exercised on this machine says so instead of passing.
#
# -CapPageMode sets how the page draws in the c60, c61 and lat runs (webgl, the
# game's path, by default). The 144 cap must bind for them to mean anything: on
# the DCHECK build the WebGL page peaks near 110 fps here, so the stage driver
# passes 2d there.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string[]]$Only = @('c10', 'c11', 'raw', 'e10', 'c21', 'v01', 'c20', 'c40', 'c41', 'c60', 'lat'),
  [ValidateSet('webgl', '2d')][string]$CapPageMode = 'webgl'
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\kcc-flags.ps1"
# powershell -File passes "-Only a,b" as one string.
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
New-Item -ItemType Directory -Force $OutDir | Out-Null
$summary = Join-Path $OutDir 'summary.txt'
Set-Content $summary "synthetic checks  $(Get-Date -Format s)`nexe: $Exe`nchecks: $($Only -join ',')`n" -Encoding utf8
$script:allPass = $true

function Say([string]$s) { Add-Content $summary $s -Encoding utf8; Write-Output $s }
function Verdict([string]$name, [bool]$ok, [string]$detail) {
  if (-not $ok) { $script:allPass = $false }
  Say ('{0,-6} {1,-5} {2}' -f $name, $(if ($ok) { 'PASS' } else { 'FAIL' }), $detail)
}
function Run([string]$name, [string[]]$argv) {
  $log = Join-Path $OutDir "$name.log"
  $code = Invoke-Electron $Exe $argv $log
  $crash = @(Select-String -Path $log -Pattern $KccCrashPattern | Select-Object -First 3 | ForEach-Object { $_.Line.Trim() })
  $json = Join-Path $OutDir "$name.json"
  $res = if (Test-Path $json) { Get-Content $json -Raw | ConvertFrom-Json } else { $null }
  return [pscustomobject]@{ code = $code; crash = $crash; res = $res; log = $log }
}
function Clean($r) { return ($r.code -eq 0) -and ($r.crash.Count -eq 0) }
function CrashNote($r) { if ($r.crash.Count) { return " | log: $($r.crash -join ' / ')" } else { return '' } }

# ---- c10: keyup after a browser-handled keydown (ungated back-port) --------
if ($Only -contains 'c10') {
  foreach ($mode in 'off', 'on') {
    $f = if ($mode -eq 'on') { Join-KccFeatures $KccAllFeatures } else { @() }
    $r = Run "c10-keyup-$mode" (@('keyup-test.js', "--kcc-out=$OutDir\c10-keyup-$mode.json") + $f)
    $failed = if ($r.res) { @($r.res.checks | Where-Object { -not $_.pass } | ForEach-Object { $_.name }) } else { @('no result') }
    Verdict 'c10' (Clean $r) "flags $mode`: exit $($r.code); page saw [$($r.res.sendInputEvent.page -join ', ')] via sendInputEvent, [$($r.res.cdp.page -join ', ')] via CDP$(if ($failed.Count) { '; failed: ' + ($failed -join '; ') })$(CrashNote $r)"
  }
}

# ---- e10: skip unobserved input emits ---------------------------------------
if ($Only -contains 'e10') {
  foreach ($mode in 'off', 'on') {
    $f = if ($mode -eq 'on') { Join-KccFeatures @('KccSkipUnobservedInputEmits') } else { @() }
    $r = Run "e10-emit-$mode" (@('input-emit-test.js', "--kcc-out=$OutDir\e10-emit-$mode.json") + $f)
    $n = if ($r.res) { @($r.res.checks).Count } else { 0 }
    $failed = if ($r.res) { @($r.res.checks | Where-Object { -not $_.pass } | ForEach-Object { "$($_.name) ($($_.detail))" }) } else { @('no result') }
    Verdict 'e10' (Clean $r) "KccSkipUnobservedInputEmits $mode`: exit $($r.code), $($n - $failed.Count)/$n checks$(if ($failed.Count) { '; failed: ' + ($failed -join '; ') })$(CrashNote $r)"
  }
}

# ---- c11: pointer-lock Esc cooldown -------------------------------------------
# Not in the brief's list (it files c11 under "cannot be meaningfully checked"),
# but the cooldown is reachable with a scripted Esc: see pointer-lock-test.js.
if ($Only -contains 'c11') {
  foreach ($mode in 'off', 'on') {
    $f = if ($mode -eq 'on') { Join-KccFeatures @('KccNoPointerLockEscCooldown') } else { @() }
    $r = Run "c11-pointer-lock-$mode" (@('pointer-lock-test.js', "--kcc-out=$OutDir\c11-pointer-lock-$mode.json") + $f)
    $n = if ($r.res) { @($r.res.checks).Count } else { 0 }
    $failed = if ($r.res) { @($r.res.checks | Where-Object { -not $_.pass } | ForEach-Object { "$($_.name) ($($_.detail))" }) } else { @('no result') }
    Verdict 'c11' (Clean $r) "KccNoPointerLockEscCooldown $mode`: exit $($r.code); re-lock $($r.res.relockAfterEsc.msAfterEsc) ms after Esc: $($r.res.relockAfterEsc.result); $($n - $failed.Count)/$n checks$(if ($failed.Count) { '; failed: ' + ($failed -join '; ') })$(CrashNote $r)"
  }
}

# ---- c12 / c13 / c14 / c15: raw input under pointer lock (SendInput) ----------
# Also outside the brief's list. Injected relative packets take the real
# WM_INPUT path (HWNDMessageHandler::OnInputEvent) with exact counts; see
# raw-input-test.js for the phases. Functional only: no cost is measured.
if ($Only -contains 'raw') {
  $raw = @{}
  $cfgs = [ordered]@{ off = @(); c12 = @('KccPinRawPointerLock'); c13 = @('KccRawInputKeepWheelMotion'); c14 = @('KccRawInputFastPath'); c15 = @('KccLeanLockedMouseMove'); all = $KccAllFeatures }
  foreach ($k in $cfgs.Keys) {
    $name = "raw-input-$k"
    $argv = @('raw-input-test.js', "--kcc-out=$OutDir\$name.json") + @(Join-KccFeatures $cfgs[$k])
    if ($k -eq 'all') { $argv += "--js-flags=$KccAllJsFlags" }
    $r = Run $name $argv
    $raw[$k] = $r
    $ph = $r.res.phases
    $fmt = { param($p) if ($p) { '({0},{1}) in {2} moves, coalesced max {3}, predicted max {4}, wheel dY {5}' -f $p.stats.mx, $p.stats.my, $p.stats.mousemoves, $p.stats.maxCoalesced, $p.stats.maxPredicted, $p.stats.wheelDeltaY } else { 'no data' } }
    Say "       raw $k`: exit $($r.code); raw-move $(& $fmt $ph.'raw-move'); raw-wheel $(& $fmt $ph.'raw-wheel'); after-plain-request $(& $fmt $ph.'after-plain-request')$(if ($r.res.problems) { ' | problems: ' + ($r.res.problems -join '; ') })$(CrashNote $r)"
  }
  $m = { param($k, $p) $raw[$k].res.phases.$p.stats }
  $off = $raw.off
  $injOk = (Clean $off) -and (& $m 'off' 'raw-move').mx -eq 200 -and (& $m 'off' 'raw-move').my -eq 120
  if (-not $injOk) {
    Say "raw    N/A   injected packets did not arrive as exact raw motion with the switches off (raw-move $((& $m 'off' 'raw-move').mx),$((& $m 'off' 'raw-move').my)); c12-c15 not checked$(CrashNote $off)"
    $script:allPass = $false
  } else {
    $wOff = (& $m 'off' 'raw-wheel').wheelDeltaY
    $s = & $m 'c12' 'after-plain-request'; $so = & $m 'off' 'after-plain-request'
    Verdict 'c12' ((Clean $raw.c12) -and $s.mx -eq 200 -and $s.my -eq 120) "after requestPointerLock() without options on a raw lock: switch off ($($so.mx),$($so.my)) (downgraded to OS-accelerated movement), on ($($s.mx),$($s.my)) (must stay raw: 200,120)$(CrashNote $raw.c12)"
    $s = & $m 'c13' 'raw-wheel'; $so = & $m 'off' 'raw-wheel'
    Verdict 'c13' ((Clean $raw.c13) -and $s.mx -eq 200 -and $s.my -eq 0 -and $s.wheelDeltaY -eq $wOff) "motion in 40 packets that also carry a wheel tick: switch off ($($so.mx),$($so.my)), on ($($s.mx),$($s.my)) (must be 200,0); wheel deltaY off $wOff, on $($s.wheelDeltaY) (must match)$(CrashNote $raw.c13)"
    $a = & $m 'c14' 'raw-move'; $b = & $m 'c14' 'raw-wheel'; $bo = & $m 'off' 'raw-wheel'
    Verdict 'c14' ((Clean $raw.c14) -and $a.mx -eq 200 -and $a.my -eq 120 -and $b.mx -eq $bo.mx -and $b.my -eq $bo.my -and $b.wheelDeltaY -eq $wOff) "same results as switch off: raw-move ($($a.mx),$($a.my)), raw-wheel motion ($($b.mx),$($b.my)) vs off ($($bo.mx),$($bo.my)), wheel deltaY $($b.wheelDeltaY) vs off $wOff$(CrashNote $raw.c14)"
    $s = & $m 'c15' 'raw-move'; $so = & $m 'off' 'raw-move'
    Verdict 'c15' ((Clean $raw.c15) -and $s.mx -eq 200 -and $s.my -eq 120 -and $s.maxCoalesced -eq 1 -and $s.maxPredicted -eq 0 -and $s.coalescedSumX -eq 200) "raw pointermoves: switch off coalesced up to $($so.maxCoalesced), predicted up to $($so.maxPredicted); on coalesced up to $($s.maxCoalesced), predicted up to $($s.maxPredicted) (must be 1 and 0); movement ($($s.mx),$($s.my)), coalesced entries sum to $($s.coalescedSumX) (must be 200,120 and 200)$(CrashNote $raw.c15)"
    $p1 = & $m 'all' 'raw-move'; $p2 = & $m 'all' 'raw-wheel'; $p3 = & $m 'all' 'after-plain-request'
    Verdict 'raw' ((Clean $raw.all) -and $p1.mx -eq 200 -and $p1.my -eq 120 -and $p1.maxCoalesced -eq 1 -and $p2.mx -eq 200 -and $p2.wheelDeltaY -eq $wOff -and $p3.mx -eq 200 -and $p3.my -eq 120) "every switch on: raw-move ($($p1.mx),$($p1.my)) coalesced max $($p1.maxCoalesced); raw-wheel ($($p2.mx),$($p2.my)) wheel $($p2.wheelDeltaY); after-plain-request ($($p3.mx),$($p3.my))$(CrashNote $raw.all)"
  }
}

# ---- c21: WebGL fast API calls vs --no-turbo-fast-api-calls ------------------
if ($Only -contains 'c21') {
  $a = Run 'c21-webgl-fast' @('webgl-fast-api-test.js', "--kcc-out=$OutDir\c21-webgl-fast.json", '--js-flags=--allow-natives-syntax')
  $b = Run 'c21-webgl-nofast' @('webgl-fast-api-test.js', "--kcc-out=$OutDir\c21-webgl-nofast.json", '--js-flags=--allow-natives-syntax --no-turbo-fast-api-calls')
  $c = Run 'c21-webgl-fast-allflags' (@('webgl-fast-api-test.js', "--kcc-out=$OutDir\c21-webgl-fast-allflags.json", "--js-flags=--allow-natives-syntax $KccAllJsFlags") + (Join-KccFeatures $KccAllFeatures))
  $pa = $a.res.page; $pb = $b.res.page; $pc = $c.res.page
  $same = $pa -and $pb -and -not $pa.error -and ($pa.errHash -eq $pb.errHash) -and ($pa.pixHash -eq $pb.pixHash) -and (($pa.errCounts | ConvertTo-Json -Compress) -eq ($pb.errCounts | ConvertTo-Json -Compress))
  $sameC = $pc -and ($pc.errHash -eq $pb.errHash) -and ($pc.pixHash -eq $pb.pixHash)
  $tf = $pa.turbofannedBeforeLoop -and $pa.turbofannedAfterLoop -and $pb.turbofannedAfterLoop
  Verdict 'c21' ((Clean $a) -and (Clean $b) -and (Clean $c) -and $same -and $sameC -and $tf) ("fast: err $($pa.errHash) pix $($pa.pixHash) errors $($pa.errTotal) $($pa.errCounts | ConvertTo-Json -Compress) loop $([math]::Round($pa.loopMs)) ms turbofan $($pa.turbofannedBeforeLoop)/$($pa.turbofannedAfterLoop); " +
    "no-fast: err $($pb.errHash) pix $($pb.pixHash) loop $([math]::Round($pb.loopMs)) ms; all flags: err $($pc.errHash) pix $($pc.pixHash); WebGL context lost $($pa.contextLost)/$($pb.contextLost)/$($pc.contextLost); renderer $($pa.renderer)$(CrashNote $a)$(CrashNote $b)$(CrashNote $c)")
}

# ---- v01: cppgc incremental sweep slice --------------------------------------
if ($Only -contains 'v01') {
  $optsFile = Join-Path $OutDir 'v01-v8-options.txt'
  $env:ELECTRON_RUN_AS_NODE = '1'
  cmd /c "`"$Exe`" --v8-options > `"$optsFile`" 2>&1"
  Remove-Item Env:\ELECTRON_RUN_AS_NODE
  $hit = Select-String -Path $optsFile -Pattern 'cppheap-max-incremental-sweep-duration-ms' -Context 0, 2 | Select-Object -First 1
  $text = if ($hit) { (@($hit.Line) + $hit.Context.PostContext | ForEach-Object { $_.Trim() }) -join ' ' } else { 'not listed' }
  Verdict 'v01' ([bool]$hit) "flag listed by --v8-options: $text"
  foreach ($ms in 0, 1, 2) {
    $name = "v01-sweep-$ms"
    $argv = @('v8-sweep-flag-test.js', "--kcc-out=$OutDir\$name.json", "--kcc-trace=$OutDir\$name-trace.json")
    if ($ms -eq 0) { $argv += '--kcc-expect-ms=5' } else { $argv += @("--kcc-expect-ms=$ms", "--js-flags=--cppheap-max-incremental-sweep-duration-ms=$ms") }
    $r = Run $name $argv
    $unknown = Select-String -Path $r.log -Pattern 'unrecognized flag|unknown flag|Error: .*cppheap' | Select-Object -First 1
    $slices = if ($r.res) { $r.res.sweepSlices | ConvertTo-Json -Compress } else { 'no result' }
    Verdict 'v01' ((Clean $r) -and -not $unknown) "$(if ($ms) { "--cppheap-max-incremental-sweep-duration-ms=$ms" } else { 'no flag (stock 5 ms)' }): exit $($r.code); slices $slices$(if ($unknown) { " | V8: $($unknown.Line.Trim())" })$(CrashNote $r)"
    Remove-Item "$OutDir\$name-trace.json" -ErrorAction SilentlyContinue  # large; the counts are in the JSON
  }
}

# ---- c20 / c30 / c31: canvas and texture page --------------------------------
if ($Only -contains 'c20') {
  $res = @{}
  foreach ($mode in 'off', 'on') {
    $name = "c20-c30-c31-$mode"
    $f = if ($mode -eq 'on') { Join-KccFeatures @('KccSkipCanvasPerfSampling', 'KccLabelTexturesOnce', 'KccCacheVsyncInterval') } else { @() }
    $trace = "$OutDir\$name-trace.json"
    $r = Run $name (@('page-check.js', '--kcc-page=canvas-texture.html', '--kcc-query=s=8', "--kcc-out=$OutDir\$name.json", "--kcc-trace=$trace", '--kcc-trace-categories=blink,gpu') + $f)
    # Slice counts by name, from the trace (page-check.js decodes it; Electron 45
    # writes Perfetto protobuf, which PowerShell cannot read).
    $tc = if ($r.res) { $r.res.traceCounts } else { $null }
    $count = { param($n) if ($tc -and $null -ne $tc.$n) { [int]$tc.$n } else { 0 } }
    $rm = & $count 'CanvasPerformanceMonitor::RecordMetrics'
    $vi = & $count 'WinVSyncProvider::GetVSyncIntervalIfAvailable'
    $vp = & $count 'WinVSyncProvider::GetVSyncParameters'
    Remove-Item $trace -ErrorAction SilentlyContinue
    $res[$mode] = [pscustomobject]@{ r = $r; rm = $rm; vi = $vi; vp = $vp; frames = $r.res.result.frames; fps = $r.res.result.fps; glError = $r.res.result.glError; lost = $r.res.result.contextLost }
    Say ("       c20/c30/c31 flags $mode`: exit $($r.code), {0} frames ({1:N1} fps), glError {2}, WebGL context lost {7}, RecordMetrics {3}, GetVSyncIntervalIfAvailable {4}, GetVSyncParameters {5}, gpu_compositing {6}$(CrashNote $r)" -f $res[$mode].frames, $res[$mode].fps, $res[$mode].glError, $rm, $vi, $vp, $r.res.gpuFeatureStatus.gpu_compositing, $res[$mode].lost)
  }
  Verdict 'c20' ((Clean $res.off.r) -and (Clean $res.on.r) -and $res.off.rm -gt 0 -and $res.on.rm -eq 0) "RecordMetrics slices: off $($res.off.rm), on $($res.on.rm) (must be > 0 and 0)"
  Verdict 'c30' ((Clean $res.off.r) -and (Clean $res.on.r) -and $res.on.glError -eq 0 -and $res.on.frames -gt 0 -and $res.on.lost -eq $false) "texture-rebind page ran without crash or DCHECK, glError $($res.on.glError), WebGL context lost $($res.on.lost), $($res.on.frames) frames with KccLabelTexturesOnce (no counter for the skipped labels in a trace)"
  if ($res.off.vi -eq 0 -and $res.on.vi -eq 0) {
    Say "c31    N/A   GetVSyncIntervalIfAvailable never ran (off $($res.off.vi), on $($res.on.vi)): DCompPresenter is not used on this machine, so KccCacheVsyncInterval was not exercised; the build ran with it on."
  } else {
    Verdict 'c31' ($res.on.vi -lt $res.off.vi) "GetVSyncIntervalIfAvailable slices: off $($res.off.vi), on $($res.on.vi)"
  }
}

# ---- c40: AudioParam coalescing ----------------------------------------------
if ($Only -contains 'c40') {
  $g = @{}
  foreach ($mode in 'off', 'on') {
    $name = "c40-audioparam-$mode"
    $f = if ($mode -eq 'on') { Join-KccFeatures @('KccAudioParamCoalesce') } else { @() }
    $r = Run $name (@('page-check.js', '--kcc-page=audioparam.html', "--kcc-out=$OutDir\$name.json") + $f)
    $g[$mode] = $r
    $desc = ($r.res.result.scenarios | ForEach-Object { '{0} t={1:N3} {2:N2}->{3:N2} ms ({4:N2}x)' -f $_.name, $_.currentTime, $_.firstMs, $_.lastMs, $_.growth }) -join '; '
    Say "       c40 flags $mode`: exit $($r.code): $desc$(CrashNote $r)"
  }
  $flat = @($g.on.res.result.scenarios | Where-Object { $_.growth -gt 1.5 }).Count -eq 0
  $stockGrows = @($g.off.res.result.scenarios | Where-Object { $_.growth -gt 3 }).Count
  Verdict 'c40' ((Clean $g.off) -and (Clean $g.on) -and $flat) "with the switch every scenario stays flat (growth <= 1.5x): $flat; stock grew > 3x in $stockGrows of $(@($g.off.res.result.scenarios).Count) scenarios"
}

# ---- c41: HRTF panner k-rate angles, bit identity ----------------------------
if ($Only -contains 'c41') {
  $h = @()
  foreach ($run in 'off-1', 'off-2', 'on-1', 'on-2') {
    $name = "c41-hrtf-$run"
    $f = if ($run -like 'on*') { Join-KccFeatures @('KccHrtfPannerKRateAngles') } else { @() }
    $r = Run $name (@('page-check.js', '--kcc-page=hrtf.html', "--kcc-out=$OutDir\$name.json", "--kcc-raw-out=$OutDir\$name.f32") + $f)
    $sha = (Get-FileHash "$OutDir\$name.f32" -Algorithm SHA256).Hash
    $h += [pscustomobject]@{ run = $run; r = $r; sha = $sha; hash = $r.res.result.hash; nonZero = $r.res.result.nonZero }
    Say "       c41 $run`: exit $($r.code), sample hash $($r.res.result.hash), sha256 $($sha.Substring(0, 16)), non-zero samples $($r.res.result.nonZero)$(CrashNote $r)"
  }
  $shas = @($h | ForEach-Object { $_.sha } | Select-Object -Unique)
  $ok = (@($h | Where-Object { -not (Clean $_.r) }).Count -eq 0) -and $shas.Count -eq 1 -and $h[0].nonZero -gt 0
  Verdict 'c41' $ok "4 renders (off x2, on x2): $($shas.Count) distinct buffer(s); identical sample for sample: $($shas.Count -eq 1)"
  Get-ChildItem "$OutDir\c41-hrtf-*.f32" | Remove-Item  # 7.7 MB each; the SHA-256 above identifies them
}

# ---- c60: GPU-process CPU time at a 144 cap ------------------------------------
if ($Only -contains 'c60') {
  $rows = @()
  foreach ($run in 'off-1', 'on-1', 'off-2', 'on-2') {
    $name = "c60-cpu-$run"
    $f = if ($run -like 'on*') { Join-KccFeatures @('KccFrameCapPreciseRelease') } else { @() }
    $r = Run $name (@('frame-cap-test.js', '--kcc-suite=cpu', '--kcc-cap=144', "--kcc-mode=$CapPageMode", "--kcc-out=$OutDir\$name.json") + $f)
    $viz = $r.res.vizCompositorPctOfCore
    $proc = $r.res.cpu.processPctOfCore
    $fps = ($r.res.measurements | Select-Object -First 1).fps
    $rows += [pscustomobject]@{ run = $run; r = $r; viz = $viz; proc = $proc; fps = $fps }
    Say ("       c60 {0}: exit {1}, cap 144 measured {2:N2} fps, VizCompositorThread {3:N1} % of a core, GPU process {4:N1} %$(CrashNote $r)" -f $run, $r.code, $fps, $viz, $proc)
  }
  $off = ($rows | Where-Object { $_.run -like 'off*' } | Measure-Object viz -Average).Average
  $on = ($rows | Where-Object { $_.run -like 'on*' } | Measure-Object viz -Average).Average
  $held = (@($rows | Where-Object { [math]::Abs($_.fps - 144) / 144 -gt 0.01 }).Count -eq 0)
  # The claim: the viz thread sleeps through the hold instead of spinning, so
  # with the switch it must use at most half of what it uses without.
  $ok = (@($rows | Where-Object { -not (Clean $_.r) }).Count -eq 0) -and $held -and ($on -le 0.5 * $off)
  Verdict 'c60' $ok ("VizCompositorThread at a 144 cap ({0} page): off {1:N1} %, on {2:N1} % of a core (mean of 2 runs each; must at least halve); the cap held in every run: {3}" -f $CapPageMode, $off, $on, $held)
}

# ---- c61: input age under a cap (trace) ----------------------------------------
# c61 (KccFrameCapLateLatch) was dropped after this check on the Stage 2 build;
# kept for a build that still has it. Not in the default list.
if ($Only -contains 'c61') {
  $lat = @{}
  foreach ($busy in 0, 3) {
    foreach ($mode in 'off', 'on') {
      $name = "c61-latency-busy$busy-$mode"
      $f = if ($mode -eq 'on') { Join-KccFeatures @('KccFrameCapLateLatch') } else { @() }
      $r = Run $name (@('frame-cap-test.js', '--kcc-suite=latency', '--kcc-cap=144', "--kcc-busy=$busy", "--kcc-mode=$CapPageMode", "--kcc-out=$OutDir\$name.json") + $f)
      $l = $r.res.latency
      $lat["$busy|$mode"] = $l
      $fps = ($r.res.measurements | Select-Object -First 1).fps
      Say ("       c61 busy {0} ms, KccFrameCapLateLatch {1} ({2} page): exit {3}, {4:N2} fps; BeginImplFrame->DrawAndSwap p10/p50/p90 {5:N2}/{6:N2}/{7:N2} ms; render (BeginImplFrame->submit) p50 {8:N2} ms; submit->display draw p50 {9:N2} ms; main frame start->display draw p50 {10:N2} ms$(CrashNote $r)" -f `
        $busy, $mode, $CapPageMode, $r.code, $fps, $l.beginImplFrameToDisplayDrawMs.p10, $l.beginImplFrameToDisplayDrawMs.p50, $l.beginImplFrameToDisplayDrawMs.p90,
        $l.beginImplFrameToSubmitMs.p50, $l.submitToDisplayDrawMs.p50, $l.beginMainFrameToDisplayDrawMs.p50)
      if (-not (Clean $r)) { $script:allPass = $false }
    }
  }
  # The brief: BeginImplFrame -> DrawAndSwap about one cap period with the
  # switch off and about the render time with it on. "About": within 30 % of
  # the period.
  $P = 1000 / 144
  foreach ($busy in 0, 3) {
    $o = $lat["$busy|off"]; $n = $lat["$busy|on"]
    if (-not $o -or -not $n) { Verdict 'c61' $false "busy $busy ms: no latency result"; continue }
    $off = $o.beginImplFrameToDisplayDrawMs.p50; $on = $n.beginImplFrameToDisplayDrawMs.p50; $rend = $n.beginImplFrameToSubmitMs.p50
    $okOff = [math]::Abs($off - $P) -le 0.3 * $P
    $okOn = $on -le $rend + 0.3 * $P
    Verdict 'c61' ($okOff -and $okOn) ("busy {0} ms, 144 cap (P {1:N2} ms): BeginImplFrame->DrawAndSwap p50 off {2:N2} ms (about P: {3}), on {4:N2} ms vs render {5:N2} ms (about render time: {6}); input age (main frame start->draw) p50 {7:N2} -> {8:N2} ms" -f `
      $busy, $P, $off, $okOff, $on, $rend, $okOn, $o.beginMainFrameToDisplayDrawMs.p50, $n.beginMainFrameToDisplayDrawMs.p50)
  }
}

# ---- lat: input age under a cap, no switch (informational) ---------------------
# What c61 set out to shorten. The stock order holds each finished frame in viz
# until the next ack release, so the content of a presented frame was started
# about one cap period (or two) before it reached the screen.
if ($Only -contains 'lat') {
  foreach ($busy in 0, 3) {
    $name = "lat-busy$busy"
    $r = Run $name @('frame-cap-test.js', '--kcc-suite=latency', '--kcc-cap=144', "--kcc-busy=$busy", "--kcc-mode=$CapPageMode", "--kcc-out=$OutDir\$name.json")
    $l = $r.res.latency
    $fps = ($r.res.measurements | Select-Object -First 1).fps
    if (-not (Clean $r)) { $script:allPass = $false }
    Say ("lat    INFO  busy {0} ms, 144 cap (P 6.94 ms, {1} page): exit {2}, {3:N2} fps; main frame start->DrawAndSwap p10/p50/p90 {4:N2}/{5:N2}/{6:N2} ms; BeginImplFrame->DrawAndSwap p50 {7:N2} ms; submit->display draw p50 {8:N2} ms$(CrashNote $r)" -f `
      $busy, $CapPageMode, $r.code, $fps, $l.beginMainFrameToDisplayDrawMs.p10, $l.beginMainFrameToDisplayDrawMs.p50, $l.beginMainFrameToDisplayDrawMs.p90,
      $l.beginImplFrameToDisplayDrawMs.p50, $l.submitToDisplayDrawMs.p50)
  }
}

Say "`n$(if ($script:allPass) { 'SYNTHETIC CHECKS: PASS' } else { 'SYNTHETIC CHECKS: SOME FAILED (see above)' })"
