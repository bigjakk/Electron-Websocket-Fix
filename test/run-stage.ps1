# Everything Stage 2 / Stage 3 of the KCC Electron 45 build brief runs on one
# binary: both release gates with the switches off and with every switch on,
# the frame-cap gate with the frame-cap switches alone and together, then the
# synthetic checks.
#
#   run-stage.ps1 -Exe <electron.exe> -OutDir <dir> [-Part gates|cap-switches|checks|all]
#                 [-FeaturesVia commandline|js] [-CapPageMode webgl|2d]
#
#   gates         gpu-status.json; WS gate off; WS gate on; frame-cap gate
#                 "off" and "all" (heavy runs interleaved)             (~45 min)
#   cap-switches  frame-cap gate "precise" (heavy runs interleaved with
#                 "off"), in <OutDir>\cap-switches             (~25 min)
#                 (The Stage 2 build also had "latch" and "both": c61,
#                 KccFrameCapLateLatch, was dropped afterwards.)
#                 Its own folder because its "off" heavy runs have the same
#                 file names as those of the gates part (in Stage 3 they were
#                 written over the gates part's, which were restored from git).
#   checks        run-checks.ps1 (every check)                       (~25 min)
#
# -FeaturesVia js: the frame-cap gate passes its --enable-features list through
#   the main script (needed on a DCHECK build; see frame-cap-test.js).
# -CapPageMode: page of the c60 / c61 checks and of the frame-cap gate's heavy
#   suite (2d where the WebGL page cannot reach 144 or its rate is too noisy to
#   compare, as on the DCHECK build here).
#
# The parts exist because a run has to stay on the interactive desktop (a
# locked or disconnected session stops rAF) and each part fits in one sitting.
# Every part appends its verdict lines to <OutDir>\stage-summary.txt.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [ValidateSet('gates', 'cap-switches', 'checks', 'all')][string]$Part = 'all',
  [ValidateSet('commandline', 'js')][string]$FeaturesVia = 'commandline',
  [ValidateSet('webgl', '2d')][string]$CapPageMode = 'webgl'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$stage = Join-Path $OutDir 'stage-summary.txt'
function Note([string]$s) { Add-Content $stage $s -Encoding utf8; Write-Output $s }
# Verdict lines: one per gate run or check, its failures, skips and re-runs,
# the heavy-suite comparison, and the final verdict of each driver.
$verdictPattern = '^(WS GATE|FRAME-CAP GATE|SYNTHETIC CHECKS)|^\S+\s+(PASS|FAIL|N/A|INFO)\s|^\S+( \(attempt \d\))?\s+exit -?\d+|^\s+(FAIL|SKIP|LOG:|FROZE)|^heavy suite|^\s+\S+\s+reach\s|\s(ok|DROP)$'
function Sub([string]$script, [string[]]$a) {
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $script) @a 2>&1 | ForEach-Object { "$_" }
  $out | ForEach-Object { Write-Output $_ }
  $out | Where-Object { $_ -match $verdictPattern } | ForEach-Object { Note "  $_" }
}
$session = (quser 2>$null | Select-String '^\s*>' | ForEach-Object { ($_.Line -replace '\s{2,}', '|').Trim() }) -join ' '
Note "== $Part  $(Get-Date -Format s)  exe $Exe  features via $FeaturesVia, c60/c61 page $CapPageMode  session: $session"

if ($Part -in 'gates', 'all') {
  Push-Location $PSScriptRoot
  cmd /c "`"$Exe`" gpu-status.js --kcc-out=`"$OutDir\gpu-status.json`" > `"$OutDir\gpu-status.log`" 2>&1"
  Pop-Location
  $g = Get-Content "$OutDir\gpu-status.json" -Raw | ConvertFrom-Json
  Note "  versions: electron $($g.versions.electron), chrome $($g.versions.chrome), v8 $($g.versions.v8), node $($g.versions.node)"
  Note "  gpu_compositing $($g.gpuFeatureStatus.gpu_compositing), webgl $($g.gpuFeatureStatus.webgl); WebGL2 renderer: $($g.webgl.webgl2.renderer)"
  Sub 'run-ws-gate.ps1' @('-Exe', $Exe, '-OutDir', $OutDir, '-Flags', 'off')
  Sub 'run-ws-gate.ps1' @('-Exe', $Exe, '-OutDir', $OutDir, '-Flags', 'on')
  Sub 'run-frame-cap-gate.ps1' @('-Exe', $Exe, '-OutDir', $OutDir, '-Variants', 'off,all', '-FeaturesVia', $FeaturesVia, '-HeavyMode', $CapPageMode)
}
if ($Part -in 'cap-switches', 'all') {
  Sub 'run-frame-cap-gate.ps1' @('-Exe', $Exe, '-OutDir', (Join-Path $OutDir 'cap-switches'), '-Variants', 'precise', '-FeaturesVia', $FeaturesVia, '-HeavyMode', $CapPageMode)
}
if ($Part -in 'checks', 'all') {
  Sub 'run-checks.ps1' @('-Exe', $Exe, '-OutDir', (Join-Path $OutDir 'checks'), '-CapPageMode', $CapPageMode)
}
Note "== $Part done  $(Get-Date -Format s)"
