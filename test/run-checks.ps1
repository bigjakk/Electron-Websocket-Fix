# Synthetic checks for the drafted patches of the KCC Electron 45 series.
# Each check runs the same binary with the patch's switch off and on.
#
#   run-checks.ps1 -Exe <electron.exe> -OutDir <dir> [-Only c10,c11,c20,c40,c60,lat]
#   ("c20" also reports c31; "lat" is informational: input age under a 144 cap,
#    no switch.)
#
# Writes one log / JSON per run into -OutDir and a summary.txt. A check that
# cannot be exercised on this machine says so instead of passing.
#
# -CapPageMode sets how the page draws in the c60 and lat runs (webgl, the
# game's path, by default). The 144 cap must bind for them to mean anything: on
# the DCHECK build the WebGL page peaks near 110 fps here, so the stage driver
# passes 2d there.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string[]]$Only = @('c10', 'c11', 'c20', 'c40', 'c60', 'lat'),
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

# ---- c20 / c31: canvas and texture page --------------------------------------
if ($Only -contains 'c20') {
  $res = @{}
  foreach ($mode in 'off', 'on') {
    $name = "c20-c31-$mode"
    $f = if ($mode -eq 'on') { Join-KccFeatures @('KccSkipCanvasPerfSampling', 'KccCacheVsyncInterval') } else { @() }
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
    Say ("       c20/c31 flags $mode`: exit $($r.code), {0} frames ({1:N1} fps), glError {2}, WebGL context lost {7}, RecordMetrics {3}, GetVSyncIntervalIfAvailable {4}, GetVSyncParameters {5}, gpu_compositing {6}$(CrashNote $r)" -f $res[$mode].frames, $res[$mode].fps, $res[$mode].glError, $rm, $vi, $vp, $r.res.gpuFeatureStatus.gpu_compositing, $res[$mode].lost)
  }
  Verdict 'c20' ((Clean $res.off.r) -and (Clean $res.on.r) -and $res.off.rm -gt 0 -and $res.on.rm -eq 0) "RecordMetrics slices: off $($res.off.rm), on $($res.on.rm) (must be > 0 and 0)"
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

# ---- lat: input age under a cap, no switch (informational) ---------------------
# The stock order holds each finished frame in viz
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
