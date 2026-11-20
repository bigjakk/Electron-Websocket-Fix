# Frame-cap release gate driver (KCC Electron 45 series).
#
#   run-frame-cap-gate.ps1 -Exe <electron.exe> -OutDir <dir>
#       [-Variants off,precise,latch,both,all] [-Busy 5]
#
# For every variant: the launch suite for CustomFrameCap:fps/60, /144 and /240,
# the runtime suite (setFrameCap 60/144/240, hide/show, resize, change at once,
# setFrameCap(0), a second animating view) and the heavy suite (a page that
# cannot reach the cap). Variants:
#   off      no KCC switch
#   precise  KccFrameCapPreciseRelease
#   latch    KccFrameCapLateLatch
#   both     KccFrameCapPreciseRelease + KccFrameCapLateLatch
#   all      every switch of the series (README "Everything on") + --js-flags
# Heavy-suite rates of every variant are compared with variant "off" when it
# ran in the same invocation: the rate must not drop by more than 3 %.
# Never combined with CustomMaxPendingFrames:count/2 (a documented conflict).
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string[]]$Variants = @('off'),
  [double]$Busy = 5
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\kcc-flags.ps1"
# powershell -File passes "-Variants a,b" as one string.
$Variants = @($Variants | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
New-Item -ItemType Directory -Force $OutDir | Out-Null
$summary = Join-Path $OutDir 'summary.txt'
Set-Content $summary "frame-cap gate  $(Get-Date -Format s)`nexe: $Exe`nvariants: $($Variants -join ',')  busy: $Busy ms`n" -Encoding utf8

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
  $runs = @()
  foreach ($n in 60, 144, 240) {
    $runs += , @("launch-$n", @('frame-cap-test.js', '--kcc-suite=launch', "--kcc-cap=$n") + (Join-KccFeatures (@("CustomFrameCap:fps/$n") + $vf)))
  }
  $runs += , @('runtime', @('frame-cap-test.js', '--kcc-suite=runtime') + (Join-KccFeatures $vf))
  $runs += , @('heavy', @('frame-cap-test.js', '--kcc-suite=heavy', "--kcc-busy=$Busy") + (Join-KccFeatures $vf))
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
      if ($r[0] -eq 'heavy') { $heavy[$v] = $res }
      if ($r[0] -eq 'runtime') { $line += "  (uncapped baseline $([math]::Round($res.uncappedBaseline, 1)) fps, renderer $($res.pageRenderer), gpu_compositing $($res.gpuFeatureStatus.gpu_compositing))" }
    } else { $line += '  NO RESULT FILE' }
    foreach ($c in $crash) { $line += "`n    LOG: $($c.Line.Trim())" }
    if ($code -ne 0 -or $crash) { $allPass = $false }
    Add-Content $summary $line -Encoding utf8
    Write-Output $line
  }
}

if ($heavy.ContainsKey('off')) {
  $base = $heavy['off']
  Add-Content $summary "`nheavy suite (busy $Busy ms) vs variant off: reach $([math]::Round($base.reach,1)), cap1000 $([math]::Round($base.cap1000,1)), cap240 $([math]::Round($base.cap240,1)), cap144 $([math]::Round($base.cap144,1))" -Encoding utf8
  foreach ($v in $heavy.Keys | Where-Object { $_ -ne 'off' }) {
    $h = $heavy[$v]
    foreach ($k in 'cap1000', 'cap240', 'cap144') {
      $ratio = $h.$k / $base.$k
      $ok = $ratio -ge 0.97
      if (-not $ok) { $allPass = $false }
      $msg = '  {0,-8} {1,-8} {2,8:N1} vs off {3,8:N1}  ({4:+0.0;-0.0} %)  {5}' -f $v, $k, $h.$k, $base.$k, (($ratio - 1) * 100), $(if ($ok) { 'ok' } else { 'DROP' })
      Add-Content $summary $msg -Encoding utf8
      Write-Output $msg
    }
  }
}
$verdict = if ($allPass) { 'FRAME-CAP GATE: PASS' } else { 'FRAME-CAP GATE: FAIL' }
Add-Content $summary "`n$verdict" -Encoding utf8
Write-Output $verdict
