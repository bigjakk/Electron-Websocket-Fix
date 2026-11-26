# One in-game comparison run: starts krunker-ab/main.js on a build, with the
# series' switches off or on, and prints the frame statistics when you quit.
#
#   run-krunker-ab.ps1 -Exe <electron.exe> -Label <name> -OutDir <dir>
#                      [-Switches off|on] [-ProfileDir <dir>] [-FrameCap 240]
#                      [-Minutes 0] [-Windowed] [-Url <page>] [-NoRawInput]
#                      [-Screenshot]
#
# Play the same thing in every run (same map and mode, a few minutes each).
# F9 toggles the frame cap, F10 quits and writes the results.
#
# The harness asks for raw mouse movement on Windows, as the client does by
# default (krunker-ab/preload.js); -NoRawInput leaves the pointer lock as the
# game requests it. The runs of 2026-11-22 were made before this existed, with
# the ordinary lock.
#
# -Switches on   every switch of the series (README "Everything on"), from
#                kcc-flags.ps1.
# -ProfileDir    browser profile for the run (login, settings). Give every
#                Electron version its own: a profile written by a newer
#                Chromium must not be opened by an older one. Never point it
#                at the real client's profile. Keep it outside the repository:
#                it holds your login.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Label,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [ValidateSet('off', 'on')][string]$Switches = 'off',
  [string]$ProfileDir = '',
  [int]$FrameCap = 240,
  [double]$Minutes = 0,
  [switch]$Windowed,
  [string]$Url = '',
  # Do not ask for raw mouse movement (the client's "Raw Input" setting off).
  [switch]$NoRawInput,
  # Save a picture of the window when the run ends (ab-<label>-<time>.jpg). It
  # shows the account name: one more reason to keep -OutDir out of the repository.
  [switch]$Screenshot
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\kcc-flags.ps1"
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

$env:KCC_AB_LABEL = $Label
$env:KCC_AB_OUT = $OutDir
$env:KCC_AB_FEATURES = if ($Switches -eq 'on') { $KccAllFeatures -join ',' } else { '' }
$env:KCC_AB_FRAME_CAP = "$FrameCap"
$env:KCC_AB_FULLSCREEN = if ($Windowed) { '0' } else { '1' }
$env:KCC_AB_MINUTES = "$Minutes"
$env:KCC_AB_URL = $Url
$env:KCC_AB_RAW_INPUT = if ($NoRawInput) { '0' } else { '1' }
$env:KCC_AB_SCREENSHOT = if ($Screenshot) { '1' } else { '0' }

$argv = @('krunker-ab')
if ($ProfileDir) {
  New-Item -ItemType Directory -Force $ProfileDir | Out-Null
  $argv += "--user-data-dir=$((Resolve-Path $ProfileDir).Path)"
}
$log = Join-Path $OutDir "ab-$Label.log"
try {
  $code = Invoke-Electron $Exe $argv $log
} finally {
  foreach ($n in 'LABEL', 'OUT', 'FEATURES', 'FRAME_CAP', 'FULLSCREEN', 'MINUTES', 'URL', 'RAW_INPUT', 'SCREENSHOT') { Remove-Item "Env:\KCC_AB_$n" -ErrorAction SilentlyContinue }
}
"exit $code"
Get-Content $log | Where-Object { $_ -match '^\[kcc-ab\]|^  (in match|menus|pointer locks|file)' }
