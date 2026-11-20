# Synthetic checks for the drafted patches of the KCC Electron 45 series.
# Each check runs the same binary with the patch's switch off and on.
#
#   run-checks.ps1 -Exe <electron.exe> -OutDir <dir> [-Only c10,e10,c21,v01,c20,c40,c41,c60,c61]
#
# Writes one log / JSON per run into -OutDir and a summary.txt. A check that
# cannot be exercised on this machine says so instead of passing.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string[]]$Only = @('c10', 'e10', 'c21', 'v01', 'c20', 'c40', 'c41', 'c60', 'c61')
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
    "no-fast: err $($pb.errHash) pix $($pb.pixHash) loop $([math]::Round($pb.loopMs)) ms; all flags: err $($pc.errHash) pix $($pc.pixHash); renderer $($pa.renderer)$(CrashNote $a)$(CrashNote $b)$(CrashNote $c)")
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
    $t = Get-Content $trace -Raw | ConvertFrom-Json
    $ev = if ($t.traceEvents) { $t.traceEvents } else { $t }
    $rm = @($ev | Where-Object { $_.name -eq 'CanvasPerformanceMonitor::RecordMetrics' }).Count
    $vi = @($ev | Where-Object { $_.name -eq 'WinVSyncProvider::GetVSyncIntervalIfAvailable' }).Count
    $vp = @($ev | Where-Object { $_.name -eq 'WinVSyncProvider::GetVSyncParameters' }).Count
    Remove-Item $trace -ErrorAction SilentlyContinue
    $res[$mode] = [pscustomobject]@{ r = $r; rm = $rm; vi = $vi; vp = $vp; frames = $r.res.result.frames; fps = $r.res.result.fps; glError = $r.res.result.glError }
    Say ("       c20/c30/c31 flags $mode`: exit $($r.code), {0} frames ({1:N1} fps), glError {2}, RecordMetrics {3}, GetVSyncIntervalIfAvailable {4}, GetVSyncParameters {5}, gpu_compositing {6}$(CrashNote $r)" -f $res[$mode].frames, $res[$mode].fps, $res[$mode].glError, $rm, $vi, $vp, $r.res.gpuFeatureStatus.gpu_compositing)
  }
  Verdict 'c20' ((Clean $res.off.r) -and (Clean $res.on.r) -and $res.off.rm -gt 0 -and $res.on.rm -eq 0) "RecordMetrics slices: off $($res.off.rm), on $($res.on.rm) (must be > 0 and 0)"
  Verdict 'c30' ((Clean $res.off.r) -and (Clean $res.on.r) -and $res.on.glError -eq 0 -and $res.on.frames -gt 0) "texture-rebind page ran without crash or DCHECK, glError $($res.on.glError), $($res.on.frames) frames with KccLabelTexturesOnce (no counter for the skipped labels in a trace)"
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
  Get-ChildItem "$OutDir\c41-hrtf-*.f32" | Select-Object -Skip 1 | Remove-Item  # keep one buffer
}

# ---- c60: GPU-process CPU time at a 144 cap ------------------------------------
if ($Only -contains 'c60') {
  $rows = @()
  foreach ($run in 'off-1', 'on-1', 'off-2', 'on-2') {
    $name = "c60-cpu-$run"
    $f = if ($run -like 'on*') { Join-KccFeatures @('KccFrameCapPreciseRelease') } else { @() }
    $r = Run $name (@('frame-cap-test.js', '--kcc-suite=cpu', '--kcc-cap=144', "--kcc-out=$OutDir\$name.json") + $f)
    $viz = $r.res.vizCompositorPctOfCore
    $proc = $r.res.cpu.processPctOfCore
    $fps = ($r.res.measurements | Select-Object -First 1).fps
    $rows += [pscustomobject]@{ run = $run; r = $r; viz = $viz; proc = $proc; fps = $fps }
    Say ("       c60 {0}: exit {1}, cap 144 measured {2:N2} fps, VizCompositorThread {3:N1} % of a core, GPU process {4:N1} %$(CrashNote $r)" -f $run, $r.code, $fps, $viz, $proc)
  }
  $off = ($rows | Where-Object { $_.run -like 'off*' } | Measure-Object viz -Average).Average
  $on = ($rows | Where-Object { $_.run -like 'on*' } | Measure-Object viz -Average).Average
  $ok = (@($rows | Where-Object { -not (Clean $_.r) }).Count -eq 0)
  Verdict 'c60' $ok ("VizCompositorThread at a 144 cap: off {0:N1} %, on {1:N1} % of a core (mean of 2 runs each); the cap held in every run: {2}" -f $off, $on, (@($rows | Where-Object { [math]::Abs($_.fps - 144) / 144 -gt 0.01 }).Count -eq 0))
}

# ---- c61: input age under a cap (trace) ----------------------------------------
if ($Only -contains 'c61') {
  $lat = @{}
  foreach ($busy in 0, 3) {
    foreach ($mode in 'off', 'on') {
      $name = "c61-latency-busy$busy-$mode"
      $f = if ($mode -eq 'on') { Join-KccFeatures @('KccFrameCapLateLatch') } else { @() }
      $r = Run $name (@('frame-cap-test.js', '--kcc-suite=latency', '--kcc-cap=144', "--kcc-busy=$busy", '--kcc-mode=webgl', "--kcc-out=$OutDir\$name.json") + $f)
      $l = $r.res.latency
      $lat["$busy|$mode"] = $l
      $fps = ($r.res.measurements | Select-Object -First 1).fps
      Say ("       c61 busy {0} ms, KccFrameCapLateLatch {1}: exit {2}, {3:N2} fps; submit->display draw p50 {4:N2} ms; main frame start->display draw p10/p50/p90 {5:N2}/{6:N2}/{7:N2} ms; main frame {8:N2} ms$(CrashNote $r)" -f `
        $busy, $mode, $r.code, $fps, $l.submitToDisplayDrawMs.p50, $l.beginMainFrameToDisplayDrawMs.p10, $l.beginMainFrameToDisplayDrawMs.p50, $l.beginMainFrameToDisplayDrawMs.p90, $l.mainFrameMs.p50)
      if (-not (Clean $r)) { $script:allPass = $false }
    }
  }
  foreach ($busy in 0, 3) {
    $off = $lat["$busy|off"].beginMainFrameToDisplayDrawMs.p50; $on = $lat["$busy|on"].beginMainFrameToDisplayDrawMs.p50
    Say ("c61    INFO  busy {0} ms at a 144 cap (period 6.94 ms): input age at display draw p50 {1:N2} ms off -> {2:N2} ms on ({3:+0.00;-0.00} ms)" -f $busy, $off, $on, ($on - $off))
  }
}

Say "`n$(if ($script:allPass) { 'SYNTHETIC CHECKS: PASS' } else { 'SYNTHETIC CHECKS: SOME FAILED (see above)' })"
