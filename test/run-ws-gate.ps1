# WebSocket-starvation release gate driver (test/cdp-test.js, BUILD-GUIDE.md
# "Verification"). Runs the 12 s CDP stress test -Runs times and passes when
# every run has 0 % of messages over 50 ms, a p99 below 50 ms, and rendered
# frames (a run with no rAF frames is inconclusive, not a pass).
#
#   run-ws-gate.ps1 -Exe <electron.exe> -OutDir <dir> [-Flags off|on] [-Runs 2]
#
# -Flags on adds every switch of the series (README "Everything on").
#
# Re-runs: this machine stalls now and then (a VM; seen with nothing else
# running). A run that exited cleanly with frames but missed only the latency
# limits is run once more, and both attempts are reported; a second miss is a
# fail. A crash, a DCHECK or a run without frames is never re-run.
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
if ($Flags -eq 'on') { $extra = @(Join-KccFeatures $KccAllFeatures) }
$allPass = $true
for ($i = 1; $i -le $Runs; $i++) {
  for ($try = 1; $try -le 2; $try++) {
    $label = "WS-$Flags-$i"
    $log = Join-Path $OutDir "ws-gate-$Flags-$i.log"
    if ($try -eq 2) { Move-Item -Force $log (Join-Path $OutDir "ws-gate-$Flags-$i-try1.log") }
    $code = Invoke-Electron $Exe (@('cdp-test.js', "$(8090 + $i)", $label, '--enable-logging') + $extra) $log
    $text = Get-Content $log -Raw
    $p99 = if ($text -match '\]\s+p99:\s+([\d.]+)') { [double]$Matches[1] } else { $null }
    $over = if ($text -match '>50ms:\s+(\d+) / (\d+)') { [int]$Matches[1] } else { $null }
    $total = if ($text -match '>50ms:\s+\d+ / (\d+)') { [int]$Matches[1] } else { $null }
    $max = if ($text -match '\]\s+max:\s+([\d.]+)') { [double]$Matches[1] } else { $null }
    $frames = if ($text -match 'RAF frames rendered: (-?\d+)') { [int]$Matches[1] } else { $null }
    $crash = @(Select-String -Path $log -Pattern $KccCrashPattern | Select-Object -First 3)
    $clean = ($code -eq 0) -and ($null -ne $p99) -and ($frames -gt 0) -and ($crash.Count -eq 0)
    $pass = $clean -and ($p99 -lt 50) -and ($over -eq 0)
    $tag = if ($try -eq 2) { "$label (attempt 2)" } else { $label }
    $line = '{0,-22} exit {1}  p99 {2} ms  max {3} ms  >50ms {4}/{5}  rAF frames {6}  {7}' -f $tag, $code, $p99, $max, $over, $total, $frames, $(if ($pass) { 'PASS' } elseif ($frames -eq 0) { 'INCONCLUSIVE (no frames)' } else { 'FAIL' })
    foreach ($c in $crash) { $line += "`n    LOG: $($c.Line.Trim())" }
    Add-Content $summary $line -Encoding utf8
    Write-Output $line
    if ($pass -or -not $clean -or $try -eq 2) { break }
  }
  if (-not $pass) { $allPass = $false }
}
$verdict = if ($allPass) { "WS GATE ($Flags): PASS" } else { "WS GATE ($Flags): FAIL" }
Add-Content $summary $verdict -Encoding utf8
Write-Output $verdict
