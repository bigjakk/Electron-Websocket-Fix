# Repeats webgl-startup-test.js with every switch off and with every switch on
# (the frame-cap gate's "all"), interleaved, and counts the launches whose
# WebGL2 context did not survive startup.
#
#   run-webgl-startup.ps1 -Exe <electron.exe> -OutDir <dir> [-Runs 60] [-Variants off,all]
#                         [-ExtraArgs '--enable-logging=stderr --v=0']
#
# Variants (comma-separated): off; all (every switch, as the gates use it);
# features (every --enable-features switch, no JS flag); js (only the JS flag);
# a feature name or names joined by + (KccA+KccB: those features alone).
# -ExtraArgs: Electron switches for every launch, space-separated
# (default --enable-logging).
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Runs = 60,
  [string[]]$Variants = @('off', 'all'),
  [string[]]$ExtraArgs = @('--enable-logging')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'kcc-flags.ps1')
New-Item -ItemType Directory -Force $OutDir | Out-Null
$summary = Join-Path $OutDir 'summary.txt'
function Note([string]$s) { Add-Content $summary $s -Encoding utf8; Write-Output $s }

$byVariant = [ordered]@{}
foreach ($v in @($Variants | ForEach-Object { $_ -split ',' } | Where-Object { $_ })) {
  $byVariant[$v] = switch -Regex ($v) {
    '^off$' { @() }
    '^all$' { @(Join-KccFeatures $KccAllFeatures) + @("--js-flags=$KccAllJsFlags") }
    '^features$' { @(Join-KccFeatures $KccAllFeatures) }
    '^js$' { @("--js-flags=$KccAllJsFlags") }
    '^Kcc' { @(Join-KccFeatures ($v -split '\+')) }
    default { throw "unknown variant $v" }
  }
}
$tally = @{}
foreach ($v in $byVariant.Keys) { $tally[$v] = @{ runs = 0; bad = 0; lost = 0; crash = 0; rates = New-Object System.Collections.ArrayList } }
Note "# $(Get-Date -Format s)  $Exe  $Runs runs per variant, interleaved"
for ($i = 1; $i -le $Runs; $i++) {
  foreach ($v in $byVariant.Keys) {
    $json = Join-Path $OutDir "$v-$i.json"
    $log = Join-Path $OutDir "$v-$i.log"
    if (Test-Path $json) { Remove-Item $json }
    $argv = @('webgl-startup-test.js', "--kcc-out=$json") + @($byVariant[$v]) + @($ExtraArgs | ForEach-Object { $_ -split ' ' } | Where-Object { $_ })
    $code = Invoke-Electron $Exe $argv $log
    $r = if (Test-Path $json) { Get-Content $json -Raw | ConvertFrom-Json } else { $null }
    $crash = @(Select-String -Path $log -Pattern $KccCrashPattern).Count
    $t = $tally[$v]
    $t.runs++
    if ($code -ne 0 -or -not $r) { $t.bad++ }
    if ($crash) { $t.crash++ }
    $lost = $r -and $r.page -and ($r.page.lost -or -not $r.page.hasGl -or $r.consoleLost.Count -gt 0)
    if ($lost) { $t.lost++ }
    if ($r -and $r.page) { [void]$t.rates.Add([double]$r.page.rafPerSec) }
    $desc = if ($r -and $r.page) { "gl $($r.page.hasGl)  lost $($r.page.lost)  rAF $($r.page.rafPerSec)/s  console-lost $($r.consoleLost.Count)  events $($r.events.Count)" } else { 'no result' }
    Note ("{0,-8} exit {1}  {2}{3}" -f "$v-$i", $code, $desc, $(if ($crash) { "  CRASH LINES $crash" } else { '' }))
  }
}
foreach ($v in $byVariant.Keys) {
  $t = $tally[$v]
  $sorted = @($t.rates | Sort-Object)
  $min = if ($sorted.Count) { $sorted[0] } else { 'n/a' }
  $med = if ($sorted.Count) { $sorted[[int][math]::Floor($sorted.Count / 2)] } else { 'n/a' }
  Note ("{0,-4} {1} runs: context lost {2}, failed {3}, crash lines {4}; rAF/s min {5} median {6}" -f $v, $t.runs, $t.lost, $t.bad, $t.crash, $min, $med)
}
