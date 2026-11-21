# Everything Stage 2 / Stage 3 of the KCC Electron 45 build brief runs on one
# binary, in the order the brief gives: both release gates with the switches
# off, both again with every switch on, the frame-cap gate with the frame-cap
# switches alone and together, then the synthetic checks.
#
#   run-stage.ps1 -Exe <electron.exe> -OutDir <dir> [-Part gates|cap-switches|checks|all]
#
#   gates         gpu-status.json; WS gate off; frame-cap gate "off";
#                 WS gate on; frame-cap gate "all"                   (~35 min)
#   cap-switches  frame-cap gate "precise", "latch", "both"          (~45 min)
#   checks        run-checks.ps1 (every check)                       (~25 min)
#
# The parts exist because a run has to stay on the interactive desktop (a
# locked or disconnected session stops rAF) and each part fits in one sitting.
# Every part appends its verdict lines to <OutDir>\stage-summary.txt.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [ValidateSet('gates', 'cap-switches', 'checks', 'all')][string]$Part = 'all'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$stage = Join-Path $OutDir 'stage-summary.txt'
function Note([string]$s) { Add-Content $stage $s -Encoding utf8; Write-Output $s }
function Sub([string]$script, [string[]]$a) {
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $script) @a 2>&1 | ForEach-Object { "$_" }
  $out | ForEach-Object { Write-Output $_ }
  # The verdict lines: one per gate run or check, failures, and the final one.
  $out | Where-Object { $_ -match '^(WS GATE|FRAME-CAP GATE|SYNTHETIC CHECKS)|^\S+\s+(PASS|FAIL|N/A|INFO)\s|^\S+\s+exit -?\d+|^\s+(FAIL|LOG:)|DROP$' } | ForEach-Object { Note "  $_" }
}
$session = (quser 2>$null | Select-String '^\s*>' | ForEach-Object { ($_.Line -replace '\s{2,}', '|').Trim() }) -join ' '
Note "== $Part  $(Get-Date -Format s)  exe $Exe  session: $session"

if ($Part -in 'gates', 'all') {
  Push-Location $PSScriptRoot
  cmd /c "`"$Exe`" gpu-status.js --kcc-out=`"$OutDir\gpu-status.json`" > `"$OutDir\gpu-status.log`" 2>&1"
  Pop-Location
  $g = Get-Content "$OutDir\gpu-status.json" -Raw | ConvertFrom-Json
  Note "  versions: electron $($g.versions.electron), chrome $($g.versions.chrome), v8 $($g.versions.v8), node $($g.versions.node)"
  Note "  gpu_compositing $($g.gpuFeatureStatus.gpu_compositing), webgl2 $($g.gpuFeatureStatus.webgl2); WebGL2 renderer: $($g.webgl.webgl2.renderer)"
  Sub 'run-ws-gate.ps1' @('-Exe', $Exe, '-OutDir', $OutDir, '-Flags', 'off')
  Sub 'run-frame-cap-gate.ps1' @('-Exe', $Exe, '-OutDir', $OutDir, '-Variants', 'off')
  Sub 'run-ws-gate.ps1' @('-Exe', $Exe, '-OutDir', $OutDir, '-Flags', 'on')
  Sub 'run-frame-cap-gate.ps1' @('-Exe', $Exe, '-OutDir', $OutDir, '-Variants', 'all')
}
if ($Part -in 'cap-switches', 'all') {
  Sub 'run-frame-cap-gate.ps1' @('-Exe', $Exe, '-OutDir', $OutDir, '-Variants', 'precise,latch,both')
}
if ($Part -in 'checks', 'all') {
  Sub 'run-checks.ps1' @('-Exe', $Exe, '-OutDir', (Join-Path $OutDir 'checks'))
}
Note "== $Part done  $(Get-Date -Format s)"
