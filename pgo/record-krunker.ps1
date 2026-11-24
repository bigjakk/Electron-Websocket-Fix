# One Krunker PGO recording: starts krunker-train/main.js on an INSTRUMENTED
# build (chrome_pgo_phase = 1) with LLVM_PROFILE_FILE set, and checks the
# .profraw files once you have quit. See README.md, step 3.
#
#   record-krunker.ps1 -Exe <instrumented electron.exe> -OutDir <new or empty dir>
#                      [-ProfileDir <dir>] [-Switches on|off] [-FrameCap 240]
#                      [-Minutes 0] [-Windowed] [-Url <page>] [-NoRawInput]
#                      [-LlvmProfdata <llvm-profdata.exe>]
#   record-krunker.ps1 -CheckOnly -OutDir <recording> -LlvmProfdata <llvm-profdata.exe>
#
# The harness asks for raw mouse movement on Windows, as the client does by
# default. -NoRawInput records the ordinary pointer lock instead.
#
# In the session: play matches uncapped, press F9 and play a little with the
# cap on, then quit with F10 or by closing the window. Never kill the process
# and never dump the counters mid-session: a process writes its counts once.
#
# -OutDir        one directory per recording. The profile files are opened in
#                merge mode, so a second recording into the same directory
#                would be added to the first: the script refuses a directory
#                that already holds .profraw files.
# -Switches on   every switch of the series and the --js-flags value, from
#                test/kcc-flags.ps1 (the default: train the patched paths).
# -ProfileDir    browser profile for the run (login, settings). It must be one
#                that only this Chromium version has opened, and never the real
#                client's profile. Keep it outside the repository.
# -LlvmProfdata  the llvm-profdata of the tree's clang. With it the script
#                merges the recording into <OutDir>\recording.profdata and
#                prints how often the WebGL draw path ran in the renderer and
#                in the GPU process, which shows that both processes wrote.
param(
  [string]$Exe = '',
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$ProfileDir = '',
  [ValidateSet('off', 'on')][string]$Switches = 'on',
  [int]$FrameCap = 240,
  [double]$Minutes = 0,
  [switch]$Windowed,
  [string]$Url = '',
  [string]$LlvmProfdata = '',
  # Do not ask for raw mouse movement (the client's "Raw Input" setting off).
  [switch]$NoRawInput,
  # Start nothing: check the recording that is already in -OutDir.
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\test\kcc-flags.ps1"

$code = 0
if ($CheckOnly) {
  if (-not (Test-Path $OutDir)) { throw "not found: $OutDir" }
  $OutDir = (Resolve-Path $OutDir).Path
} else {
  if (-not $Exe -or -not (Test-Path $Exe)) { throw "-Exe: instrumented electron.exe not found: $Exe" }
  $Exe = (Resolve-Path $Exe).Path
  New-Item -ItemType Directory -Force $OutDir | Out-Null
  $OutDir = (Resolve-Path $OutDir).Path
  if (@(Get-ChildItem $OutDir -Filter *.profraw).Count) {
    throw "$OutDir already holds .profraw files. Use a new directory for each recording."
  }

  $env:LLVM_PROFILE_FILE = Join-Path $OutDir 'kcc-%4m.profraw'
  $env:KCC_PGO_FEATURES = if ($Switches -eq 'on') { $KccAllFeatures -join ',' } else { '' }
  $env:KCC_PGO_JS_FLAGS = if ($Switches -eq 'on') { $KccAllJsFlags } else { '' }
  $env:KCC_PGO_FRAME_CAP = "$FrameCap"
  $env:KCC_PGO_FULLSCREEN = if ($Windowed) { '0' } else { '1' }
  $env:KCC_PGO_MINUTES = "$Minutes"
  $env:KCC_PGO_URL = $Url
  $env:KCC_PGO_RAW_INPUT = if ($NoRawInput) { '0' } else { '1' }

  $argv = @((Join-Path $PSScriptRoot 'krunker-train'))
  if ($ProfileDir) {
    New-Item -ItemType Directory -Force $ProfileDir | Out-Null
    $argv += "--user-data-dir=$((Resolve-Path $ProfileDir).Path)"
  }
  $log = Join-Path $OutDir 'record.log'
  try {
    $code = Invoke-Electron $Exe $argv $log
  } finally {
    Remove-Item Env:\LLVM_PROFILE_FILE -ErrorAction SilentlyContinue
    foreach ($n in 'FEATURES', 'JS_FLAGS', 'FRAME_CAP', 'FULLSCREEN', 'MINUTES', 'URL', 'RAW_INPUT') { Remove-Item "Env:\KCC_PGO_$n" -ErrorAction SilentlyContinue }
  }
  "exit $code"
  Get-Content $log | Where-Object { $_ -match '^\[pgo-train\]|^# ' }
}

# The browser process writes kcc-<signature>_<n>.profraw at exit. Every child
# (renderer, GPU, network service, ...) writes child_pool-<0..3>.profraw; two
# children can share one file. A child's file is created empty at process
# start, so an empty one is a process that never wrote.
$raw = @(Get-ChildItem $OutDir -Filter *.profraw | Sort-Object Name)
''
'profile files:'
$raw | ForEach-Object { '  {0,-44} {1,14:N0} bytes' -f $_.Name, $_.Length }
$browser = @($raw | Where-Object { $_.Name -like 'kcc-*' -and $_.Length -gt 0 })
$children = @($raw | Where-Object { $_.Name -like 'child_pool-*' -and $_.Length -gt 0 })
$empty = @($raw | Where-Object { $_.Length -eq 0 })
$problems = @()
$warnings = @()
if ($code -ne 0) { $problems += "electron exited with code $code" }
if (-not $browser.Count) { $problems += 'no browser-process file (kcc-*.profraw): the build is not instrumented, or it was killed' }
if (-not $children.Count) { $problems += 'no child-process file (child_pool-*.profraw) with data: the renderer and GPU counts are missing' }
if ($empty.Count) { "  note: $($empty.Count) empty file(s): $($empty.Name -join ', ') (a process that never wrote; harmless if the counts below are there)" }

# How often the WebGL draw path ran, per process: the renderer side is blink's
# WebGLRenderingContextBase, the GPU side the passthrough command decoder.
# An IR-level profile has no "Function count" line; the largest block count of
# a function stands for how often it ran (a function with one counter: exactly).
function Get-FunctionCounts([string]$tool, [string]$profdata, [string]$substring) {
  $name = ''
  $rows = @()
  foreach ($line in (& $tool show --counts "--function=$substring" $profdata 2>&1)) {
    if ($line -match '^\s{2}(\S.*):$') { $name = $Matches[1] }
    elseif ($name -and $line -match '^\s+Block counts:\s*\[(.*)\]') {
      $max = [decimal]0
      foreach ($n in ($Matches[1] -split ',\s*' | Where-Object { $_ })) { if ([decimal]$n -gt $max) { $max = [decimal]$n } }
      $rows += [pscustomobject]@{ Name = $name; Count = $max }
      $name = ''
    }
  }
  return $rows
}
if ($LlvmProfdata -and $raw.Count) {
  if (-not (Test-Path $LlvmProfdata)) { throw "not found: $LlvmProfdata" }
  $merged = Join-Path $OutDir 'recording.profdata'
  $listing = Join-Path $OutDir 'recording-inputs.txt'
  [IO.File]::WriteAllLines($listing, [string[]]@($raw | Where-Object { $_.Length -gt 0 } | ForEach-Object { $_.FullName }))
  $out = & $LlvmProfdata merge -o $merged "--input-files=$listing" 2>&1
  if ($LASTEXITCODE -ne 0) { $problems += "llvm-profdata merge failed: $($out -join ' ')" }
  else {
    ''
    'merged recording:'
    & $LlvmProfdata show --detailed-summary $merged 2>&1 | Where-Object { $_ -match '^(Total functions|Maximum function count|Total count):' } | ForEach-Object { "  $_" }
    # Kind 'need': no counts is a failed recording. 'raw' and 'warp' tell which
    # mouse path ran while the pointer was locked: WM_INPUT packets are the raw
    # path the client uses; a cursor re-centre only happens on a lock that is
    # not raw.
    $checks = @(
      @{ Kind = 'need'; Label = 'renderer: WebGLRenderingContextBase draw calls'; Sub = 'WebGLRenderingContextBase'; Match = '(?i)\?draw(Elements|Arrays)' },
      @{ Kind = 'need'; Label = 'GPU: passthrough decoder DoDraw*'; Sub = 'GLES2DecoderPassthroughImpl'; Match = '\?DoDraw(Elements|Arrays)' },
      @{ Kind = 'need'; Label = 'GPU: viz Display::DrawAndSwap'; Sub = 'DrawAndSwap'; Match = '\?DrawAndSwap@Display@viz@@' },
      @{ Kind = 'raw'; Label = 'browser: raw mouse packets (WM_INPUT)'; Sub = 'OnInputEvent'; Match = '\?OnInputEvent@HWNDMessageHandler@views@@' },
      @{ Kind = 'warp'; Label = 'browser: cursor re-centres (lock not raw)'; Sub = 'MoveCursorToCenter'; Match = '\?MoveCursorToCenter@RenderWidgetHostViewEventHandler@' }
    )
    foreach ($c in $checks) {
      $rows = @(Get-FunctionCounts $LlvmProfdata $merged $c.Sub | Where-Object { $_.Name -match $c.Match })
      $sum = ($rows | Measure-Object Count -Sum).Sum
      '  {0,-48} {1,16:N0}  ({2} functions)' -f $c.Label, $sum, $rows.Count
      if ($c.Kind -eq 'need' -and -not $sum) { $problems += "$($c.Label): no counts" }
      if ($c.Kind -eq 'raw' -and -not $sum -and -not $NoRawInput) { $warnings += 'no raw mouse packets: the pointer lock was never raw, so the mouse path the client uses was not recorded' }
      if ($c.Kind -eq 'warp' -and $sum -and -not $NoRawInput) { $warnings += "$('{0:N0}' -f $sum) cursor re-centres: the pointer lock was not raw for at least part of the session" }
    }
  }
}
''
if ($problems.Count) {
  'RECORDING NOT USABLE AS IT IS:'
  $problems | ForEach-Object { "  - $_" }
  exit 1
}
if ($warnings.Count) {
  'WARNING:'
  $warnings | ForEach-Object { "  - $_" }
}
"recording ok: $OutDir"
