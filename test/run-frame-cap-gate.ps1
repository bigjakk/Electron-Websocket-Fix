# Frame-cap release gate driver (KCC Electron 45 series).
#
#   run-frame-cap-gate.ps1 -Exe <electron.exe> -OutDir <dir>
#       [-Variants off,precise,all] [-Busy 5,3] [-HeavyRuns 3]
#       [-FeaturesVia commandline|js]
#
# Part A, for every variant: the launch suite for CustomFrameCap:fps/60, /144 and
# /240 (2D page), and the runtime suite (setFrameCap 60/144/240, hide/show,
# resize, change at once, setFrameCap(0), a second animating view) with a 2D and
# with a WebGL2 page.
# Part B: the heavy suite (a page that spins -Busy ms per frame, so caps of 1000
# and 240 are above its reach), -HeavyRuns times per busy value, the variants
# interleaved with variant "off" in every round; for each cap the best run of a
# variant must not be more than 3 % below the best run of "off" (the brief: a
# cap above reach must not lose rate). Best, not median: this VM drops into
# stretches of tens of seconds where everything but the page's own spin takes
# ~2.5x longer (busy 5 ms page: frame p50 8.2 instead of 6.3 ms, sd 1.8
# instead of 0.3), for every variant alike. The environment can only make a run
# slower, and a real cost of a switch lowers its best run too. Medians and every
# run are reported as well.
# -Parts A,B (default both) runs only part A or part B.
# Variants:
#   off      no KCC switch
#   precise  KccFrameCapPreciseRelease
#   all      every switch of the series (README "Everything on")
# Never combined with CustomMaxPendingFrames:count/2 (a documented conflict).
#
# -FeaturesVia js passes the --enable-features list as --kcc-features, which
# frame-cap-test.js appends from the main script. Needed on a DCHECK build:
# there, field-trial parameters on the command line (CustomFrameCap:fps/N) stop
# stock Electron at startup (see frame-cap-test.js). The default is the command
# line, as BUILD-GUIDE.md describes it.
#
# Re-runs: this machine's frame rate stalls now and then (seen with and without
# the series, with nothing else running). A run whose only failures are rate
# checks is run once more and both attempts are reported; a second miss is a
# fail. A crash, a DCHECK, a harness error, a frozen window (a measurement that
# timed out), a run with no frames or a missing result file is never re-run.
# The summary is summary-<variants>.txt.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string[]]$Variants = @('off'),
  # Per-frame JS work of the heavy suite. 5 ms: the page cannot reach 144 or
  # above (cap above reach). 3 ms: on a release build a 144 cap binds with ~40 %
  # of the period to spare.
  [string[]]$Busy = @('5', '3'),
  [int]$HeavyRuns = 5,
  [string[]]$Parts = @('A', 'B'),
  # Page of the heavy suite. WebGL2 (the game's path) by default; on the DCHECK
  # build here its rate varies by 30 % from run to run (84-118 fps, same
  # binary, same switches), which no 3 % comparison survives, while the 2D page
  # with the same per-frame spin varies by about 2 %.
  [ValidateSet('webgl', '2d')][string]$HeavyMode = 'webgl',
  [ValidateSet('commandline', 'js')][string]$FeaturesVia = 'commandline',
  # Shorter measurement windows, for trying out the driver only (the gate is 10 s).
  [int]$WindowMs = 0
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\kcc-flags.ps1"
# powershell -File passes "-Variants a,b" as one string.
$Variants = @($Variants | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$Busy = @($Busy | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$Parts = @($Parts | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
New-Item -ItemType Directory -Force $OutDir | Out-Null
$summary = Join-Path $OutDir "summary-$($Variants -join '-').txt"
Set-Content $summary ("frame-cap gate  $(Get-Date -Format s)`nexe: $Exe`nvariants: $($Variants -join ',')  " +
  "parts: $($Parts -join ',')  heavy suite: $HeavyMode page, busy $($Busy -join ', ') ms, $HeavyRuns runs each  features via: $FeaturesVia`n") -Encoding utf8
function Say([string]$s) { Add-Content $summary $s -Encoding utf8; Write-Output $s }

function Get-VariantFeatures([string]$v) {
  switch ($v) {
    'off' { return @() }
    'precise' { return @('KccFrameCapPreciseRelease') }
    'all' { return $KccAllFeatures }
    default { throw "unknown variant $v" }
  }
}
function Get-FeatureArgs([string[]]$features) {
  $a = @(Join-KccFeatures $features)
  if ($FeaturesVia -eq 'js') { $a = @($a | ForEach-Object { $_ -replace '^--enable-features=', '--kcc-features=' }) }
  return $a
}

# One suite run, re-run once when only rate checks failed. Returns the attempts.
function Invoke-Suite([string]$name, [string[]]$argv) {
  $json = Join-Path $OutDir "$name.json"; $log = Join-Path $OutDir "$name.log"
  $attempts = @()
  for ($try = 1; $try -le 2; $try++) {
    if ($try -eq 2) {
      # Keep the first attempt next to the second.
      $j1 = Join-Path $OutDir "$name-try1.json"; $l1 = Join-Path $OutDir "$name-try1.log"
      Move-Item -Force $json $j1; Move-Item -Force $log $l1
      $attempts[0].json = $j1; $attempts[0].log = $l1
    }
    Remove-Item $json -ErrorAction SilentlyContinue
    $wm = if ($WindowMs -gt 0) { @("--kcc-window-ms=$WindowMs") } else { @() }
    $code = Invoke-Electron $Exe ($argv + $wm + @("--kcc-out=$json", '--enable-logging')) $log
    $res = if (Test-Path $json) { Get-Content $json -Raw | ConvertFrom-Json } else { $null }
    $crash = @(Select-String -Path $log -Pattern $KccCrashPattern | Select-Object -First 3)
    $froze = [bool]($res -and @($res.measurements | Where-Object { $_.error }).Count -gt 0)
    $attempts += [pscustomobject]@{ try = $try; code = $code; res = $res; crash = $crash; froze = $froze; json = $json; log = $log }
    $retry = ($code -eq 1) -and $res -and -not $froze -and $crash.Count -eq 0
    if (-not $retry) { break }
  }
  return , $attempts
}

# Summary lines for one suite. Its output is those lines, so the verdict goes
# to $script:suitePass: the last attempt passed and no attempt crashed.
function Write-Suite([string]$name, $attempts) {
  foreach ($a in $attempts) {
    $tag = if ($attempts.Count -gt 1) { "$name (attempt $($a.try))" } else { $name }
    $line = '{0,-30} exit {1}' -f $tag, $a.code
    if ($a.res) {
      $failed = @($a.res.checks | Where-Object { -not $_.pass })
      $line += "  checks $($a.res.checks.Count - $failed.Count)/$($a.res.checks.Count)"
      if ($a.res.suite -eq 'heavy') { $line += "  (busy $($a.res.busy) ms: reach $([math]::Round($a.res.reach, 1)), cap1000 $([math]::Round($a.res.cap1000, 1)), cap240 $([math]::Round($a.res.cap240, 1)), cap144 $([math]::Round($a.res.cap144, 1)))" }
      if ($a.res.suite -eq 'runtime') { $line += "  (uncapped baseline $([math]::Round($a.res.uncappedBaseline, 1)) fps, page $($a.res.pageRenderer))" }
      foreach ($f in $failed) { $line += "`n    FAIL $($f.name): $($f.detail)" }
      foreach ($s in @($a.res.skipped)) { if ($s) { $line += "`n    SKIP $($s.name): $($s.why)" } }
      if ($a.froze) { $line += "`n    FROZE: a measurement timed out" }
    } else { $line += '  NO RESULT FILE' }
    foreach ($c in $a.crash) { $line += "`n    LOG: $($c.Line.Trim())" }
    Say $line
  }
  $crashes = @($attempts | Where-Object { $_.crash.Count -gt 0 }).Count
  $script:suitePass = ($attempts[-1].code -eq 0) -and ($crashes -eq 0)
}

$allPass = $true

# ---- part A: launch and runtime suites ---------------------------------------
foreach ($v in $(if ($Parts -contains 'A') { $Variants } else { @() })) {
  $vf = Get-VariantFeatures $v
  # Launch caps and the first runtime suite draw with a 2D canvas: on a machine
  # without a GPU that leaves headroom far above 240. The second runtime suite
  # and the heavy suite draw with WebGL2, the game's path.
  # Each entry is (name, argv). The argv must be parenthesised: inside @(...)
  # the comma binds tighter than +, so "a", @(x) + y would make y a third entry.
  $runs = @()
  foreach ($n in 60, 144, 240) {
    $runs += , @("launch-$n", (@('frame-cap-test.js', '--kcc-suite=launch', "--kcc-cap=$n", '--kcc-mode=2d') + @(Get-FeatureArgs (@("CustomFrameCap:fps/$n") + $vf))))
  }
  $runs += , @('runtime-2d', (@('frame-cap-test.js', '--kcc-suite=runtime', '--kcc-mode=2d') + @(Get-FeatureArgs $vf)))
  $runs += , @('runtime-webgl', (@('frame-cap-test.js', '--kcc-suite=runtime', '--kcc-mode=webgl') + @(Get-FeatureArgs $vf)))
  foreach ($r in $runs) {
    $name = "$v-$($r[0])"
    $att = Invoke-Suite $name $r[1]
    Write-Suite $name $att
    if (-not $script:suitePass) { $allPass = $false }
  }
}

# ---- part B: heavy suite, variants interleaved with "off" --------------------
$heavyVariants = @('off') + @($Variants | Where-Object { $_ -ne 'off' })
$heavy = @{}
if ($Parts -notcontains 'B') { $Busy = @() }
foreach ($b in $Busy) {
  for ($i = 1; $i -le $HeavyRuns; $i++) {
    foreach ($v in $heavyVariants) {
      $vf = Get-VariantFeatures $v
      $name = "$v-heavy-$b-$i"
      $att = Invoke-Suite $name (@('frame-cap-test.js', '--kcc-suite=heavy', "--kcc-busy=$b", "--kcc-mode=$HeavyMode") + @(Get-FeatureArgs $vf))
      Write-Suite $name $att
      if (-not $script:suitePass) { $allPass = $false }
      $res = $att[-1].res
      if ($res -and $att[-1].code -eq 0) {
        if (-not $heavy.ContainsKey("$v|$b")) { $heavy["$v|$b"] = @() }
        $heavy["$v|$b"] += , $res
      }
    }
  }
}
function Get-Median([double[]]$x) {
  $s = @($x | Sort-Object); if ($s.Count -eq 0) { return [double]::NaN }
  if ($s.Count % 2) { return $s[[int](($s.Count - 1) / 2)] }
  return ($s[$s.Count / 2 - 1] + $s[$s.Count / 2]) / 2
}
foreach ($b in $Busy) {
  $base = $heavy["off|$b"]
  if (-not $base) { Say "`nheavy suite, busy $b ms: no passing run of variant off"; $allPass = $false; continue }
  $fmt = { param($rs, $k) ($rs | ForEach-Object { [math]::Round($_.$k, 1) }) -join ' / ' }
  $best = { param($rs, $k) ($rs | ForEach-Object { [double]$_.$k } | Measure-Object -Maximum).Maximum }
  Say "`nheavy suite, busy $b ms, $HeavyRuns runs per variant: best / median [each run]"
  foreach ($v in $heavyVariants) {
    $rs = $heavy["$v|$b"]
    if (-not $rs) { Say "  $v`: no passing run"; if ($v -ne 'off') { $allPass = $false }; continue }
    $cells = foreach ($k in 'reach', 'cap1000', 'cap240', 'cap144') {
      '{0} {1:N1} / {2:N1} [{3}]' -f $k, (& $best $rs $k), (Get-Median ($rs | ForEach-Object { $_.$k })), (& $fmt $rs $k)
    }
    Say ('  {0,-8} {1}' -f $v, ($cells -join '  '))
  }
  foreach ($v in $heavyVariants | Where-Object { $_ -ne 'off' }) {
    $rs = $heavy["$v|$b"]
    if (-not $rs) { continue }
    foreach ($k in 'cap1000', 'cap240', 'cap144') {
      $bv = & $best $rs $k; $bo = & $best $base $k
      $ratio = $bv / $bo
      $ok = $ratio -ge 0.97
      if (-not $ok) { $allPass = $false }
      $mratio = (Get-Median ($rs | ForEach-Object { $_.$k })) / (Get-Median ($base | ForEach-Object { $_.$k }))
      Say ('  {0,-12} {1,-8} best {2,7:N1} vs off {3,7:N1}  ({4:+0.0;-0.0} %; medians {5:+0.0;-0.0} %)  {6}' -f "$v|$b", $k, $bv, $bo, (($ratio - 1) * 100), (($mratio - 1) * 100), $(if ($ok) { 'ok' } else { 'DROP' }))
    }
  }
}
$verdict = if ($allPass) { 'FRAME-CAP GATE: PASS' } else { 'FRAME-CAP GATE: FAIL' }
Say "`n$verdict"
