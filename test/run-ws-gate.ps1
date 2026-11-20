# WebSocket-starvation release gate driver (test/cdp-test.js, BUILD-GUIDE.md
# "Verification"). Runs the 12 s CDP stress test -Runs times and passes when
# every run has 0 % of messages over 50 ms, a p99 below 50 ms, and rendered
# frames (a run with no rAF frames is inconclusive, not a pass).
#
#   run-ws-gate.ps1 -Exe <electron.exe> -OutDir <dir> [-Flags off|on] [-Runs 2]
#
# -Flags on adds every switch of the series (README "Everything on") and the
# --js-flags value.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [ValidateSet('off', 'on')][string]$Flags = 'off',
  [int]$Runs = 2
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\kcc-flags.ps1"
New-Item -ItemType Directory -Force $OutDir | Out-Null
$summary = Join-Path $OutDir "ws-gate-$Flags.txt"
Set-Content $summary "WS starvation gate  flags $Flags  $(Get-Date -Format s)`nexe: $Exe`n" -Encoding utf8

$extra = @()
if ($Flags -eq 'on') { $extra = (Join-KccFeatures $KccAllFeatures) + @("--js-flags=$KccAllJsFlags") }
$allPass = $true
for ($i = 1; $i -le $Runs; $i++) {
  $label = "WS-$Flags-$i"
  $log = Join-Path $OutDir "ws-gate-$Flags-$i.log"
  $code = Invoke-Electron $Exe (@('cdp-test.js', "$(8090 + $i)", $label, '--enable-logging') + $extra) $log
  $text = Get-Content $log -Raw
  $p99 = if ($text -match '\]\s+p99:\s+([\d.]+)') { [double]$Matches[1] } else { $null }
  $over = if ($text -match '>50ms:\s+(\d+) / (\d+)') { [int]$Matches[1] } else { $null }
  $total = if ($text -match '>50ms:\s+\d+ / (\d+)') { [int]$Matches[1] } else { $null }
  $frames = if ($text -match 'RAF frames rendered: (-?\d+)') { [int]$Matches[1] } else { $null }
  $crash = Select-String -Path $log -Pattern $KccCrashPattern | Select-Object -First 3
  $pass = ($code -eq 0) -and ($null -ne $p99) -and ($p99 -lt 50) -and ($over -eq 0) -and ($frames -gt 0) -and (-not $crash)
  if (-not $pass) { $allPass = $false }
  $line = '{0,-10} exit {1}  p99 {2} ms  >50ms {3}/{4}  rAF frames {5}  {6}' -f $label, $code, $p99, $over, $total, $frames, $(if ($pass) { 'PASS' } elseif ($frames -eq 0) { 'INCONCLUSIVE (no frames)' } else { 'FAIL' })
  foreach ($c in $crash) { $line += "`n    LOG: $($c.Line.Trim())" }
  Add-Content $summary $line -Encoding utf8
  Write-Output $line
}
$verdict = if ($allPass) { "WS GATE ($Flags): PASS" } else { "WS GATE ($Flags): FAIL" }
Add-Content $summary $verdict -Encoding utf8
Write-Output $verdict
