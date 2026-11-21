# Frame-cap release gate driver (KCC Electron 45 series).
#
#   run-frame-cap-gate.ps1 -Exe <electron.exe> -OutDir <dir>
#       [-Variants off,precise,latch,both,all] [-Busy 5]
#
# For every variant: the launch suite for CustomFrameCap:fps/60, /144 and /240
# (2D page), the runtime suite (setFrameCap 60/144/240, hide/show, resize, change
# at once, setFrameCap(0), a second animating view) with a 2D and with a WebGL2
# page, and the heavy suite (WebGL2 page that cannot reach the cap). Variants:
#   off      no KCC switch
#   precise  KccFrameCapPreciseRelease
#   latch    KccFrameCapLateLatch
#   both     KccFrameCapPreciseRelease + KccFrameCapLateLatch
#   all      every switch of the series (README "Everything on") + --js-flags
# Heavy-suite rates of every variant are compared with variant "off", from this
# invocation or, failing that, from off-heavy-<busy>.json already in -OutDir
# (so variants can run in separate invocations): the rate must not drop by more
# than 3 %. The summary is summary-<variants>.txt.
# Never combined with CustomMaxPendingFrames:count/2 (a documented conflict).
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string[]]$Variants = @('off'),
  # Per-frame JS work of the heavy suite, one run per value. 5 ms: the page
  # cannot reach 144 or above (cap above reach). 3 ms: a 144 cap binds with
  # ~40 % of the period to spare, which is where KccFrameCapLateLatch engages.
  [string[]]$Busy = @('5', '3')
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\kcc-flags.ps1"
# powershell -File passes "-Variants a,b" as one string.
$Variants = @($Variants | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$Busy = @($Busy | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
New-Item -ItemType Directory -Force $OutDir | Out-Null
$summary = Join-Path $OutDir "summary-$($Variants -join '-').txt"
Set-Content $summary "frame-cap gate  $(Get-Date -Format s)`nexe: $Exe`nvariants: $($Variants -join ',')  heavy-suite busy: $($Busy -join ', ') ms`n" -Encoding utf8

function Get-VariantFeatures([string]$v) {
  switch ($v) {
    'off' { return @() }
    'precise' { return @('KccFrameCapPreciseRelease') }
    'latch' { return @('KccFrameCapLateLatch') }
    'both' { return @('KccFrameCapPreciseRelease', 'KccFrameCapLateLatch') }
    'all' { return $KccAllFeatures }
    default { throw "unknown variant $v" }
  }
}

$allPass = $true
$heavy = @{}
foreach ($v in $Variants) {
  $vf = Get-VariantFeatures $v
  $js = if ($v -eq 'all') { @("--js-flags=$KccAllJsFlags") } else { @() }
  # Launch caps and the first runtime suite draw with a 2D canvas: on a machine
  # without a GPU that leaves headroom far above 240. The second runtime suite
  # and the heavy suite draw with WebGL2, the game's path.
  # Each entry is (name, argv). The argv must be parenthesised: inside @(...)
  # the comma binds tighter than +, so "a", @(x) + y would make y a third entry.
  $runs = @()
  foreach ($n in 60, 144, 240) {
    $runs += , @("launch-$n", (@('frame-cap-test.js', '--kcc-suite=launch', "--kcc-cap=$n", '--kcc-mode=2d') + @(Join-KccFeatures (@("CustomFrameCap:fps/$n") + $vf))))
  }
  $runs += , @('runtime-2d', (@('frame-cap-test.js', '--kcc-suite=runtime', '--kcc-mode=2d') + @(Join-KccFeatures $vf)))
  $runs += , @('runtime-webgl', (@('frame-cap-test.js', '--kcc-suite=runtime', '--kcc-mode=webgl') + @(Join-KccFeatures $vf)))
  foreach ($b in $Busy) {
    $runs += , @("heavy-$b", (@('frame-cap-test.js', '--kcc-suite=heavy', "--kcc-busy=$b", '--kcc-mode=webgl') + @(Join-KccFeatures $vf)))
  }
  foreach ($r in $runs) {
    $name = "$v-$($r[0])"
    $json = Join-Path $OutDir "$name.json"
    $log = Join-Path $OutDir "$name.log"
    $argv = $r[1] + @("--kcc-out=$json", '--enable-logging') + $js
    $code = Invoke-Electron $Exe $argv $log
    $res = if (Test-Path $json) { Get-Content $json -Raw | ConvertFrom-Json } else { $null }
    $crash = Select-String -Path $log -Pattern $KccCrashPattern | Select-Object -First 3
    $line = '{0,-22} exit {1}' -f $name, $code
    if ($res) {
      $failed = @($res.checks | Where-Object { -not $_.pass })
      $line += "  checks $($res.checks.Count - $failed.Count)/$($res.checks.Count)"
      foreach ($f in $failed) { $line += "`n    FAIL $($f.name): $($f.detail)" }
      foreach ($s in @($res.skipped)) { if ($s) { $line += "`n    SKIP $($s.name): $($s.why)" } }
      if ($r[0] -like 'heavy-*') { $heavy["$v|$($res.busy)"] = $res; $line += "  (busy $($res.busy) ms page reaches $([math]::Round($res.reach, 1)) fps uncapped; cap1000 $([math]::Round($res.cap1000, 1)), cap240 $([math]::Round($res.cap240, 1)), cap144 $([math]::Round($res.cap144, 1)))" }
      if ($r[0] -like 'runtime*') { $line += "  (uncapped baseline $([math]::Round($res.uncappedBaseline, 1)) fps, page $($res.pageRenderer), gpu_compositing $($res.gpuFeatureStatus.gpu_compositing))" }
    } else { $line += '  NO RESULT FILE' }
    foreach ($c in $crash) { $line += "`n    LOG: $($c.Line.Trim())" }
    if ($code -ne 0 -or $crash) { $allPass = $false }
    Add-Content $summary $line -Encoding utf8
    Write-Output $line
  }
}

# The rate must not drop compared with the same suite with the switches off.
foreach ($b in $Busy) {
  $baseKey = "off|$b"
  $offJson = Join-Path $OutDir "off-heavy-$b.json"
  if (-not $heavy.ContainsKey($baseKey) -and (Test-Path $offJson)) {
    $heavy[$baseKey] = Get-Content $offJson -Raw | ConvertFrom-Json
    Add-Content $summary "`n(variant off for busy $b ms read from $offJson, $((Get-Item $offJson).LastWriteTime.ToString('s')))" -Encoding utf8
  }
  if (-not $heavy.ContainsKey($baseKey)) { continue }
  $base = $heavy[$baseKey]
  Add-Content $summary "`nheavy suite, busy $b ms, variant off: reach $([math]::Round($base.reach,1)), cap1000 $([math]::Round($base.cap1000,1)), cap240 $([math]::Round($base.cap240,1)), cap144 $([math]::Round($base.cap144,1))" -Encoding utf8
  foreach ($key in $heavy.Keys | Where-Object { $_ -like "*|$b" -and $_ -ne $baseKey }) {
    $h = $heavy[$key]
    foreach ($k in 'cap1000', 'cap240', 'cap144') {
      $ratio = $h.$k / $base.$k
      $ok = $ratio -ge 0.97
      if (-not $ok) { $allPass = $false }
      $msg = '  {0,-12} {1,-8} {2,8:N1} vs off {3,8:N1}  ({4:+0.0;-0.0} %)  {5}' -f $key, $k, $h.$k, $base.$k, (($ratio - 1) * 100), $(if ($ok) { 'ok' } else { 'DROP' })
      Add-Content $summary $msg -Encoding utf8
      Write-Output $msg
    }
  }
}
$verdict = if ($allPass) { 'FRAME-CAP GATE: PASS' } else { 'FRAME-CAP GATE: FAIL' }
Add-Content $summary "`n$verdict" -Encoding utf8
Write-Output $verdict
