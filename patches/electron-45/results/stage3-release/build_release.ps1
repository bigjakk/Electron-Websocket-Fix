# Stage 3 driver for the KCC Electron 45.4.1 series: the official Release build
# in out\Release (args as in BUILD-GUIDE.md, plus the version override the
# Testing build also uses, because src/electron carries local commits).
#
#   build_release.ps1 -Phase gen      write args.gn (if -WriteArgs) and gn gen
#   build_release.ps1 -Phase full     autoninja electron
#   build_release.ps1 -Phase zip      autoninja electron:electron_dist_zip
#
# Launched detached (WMI Win32_Process.Create). Every phase appends to
# C:\electron\build_r_driver.log; its last line is "PHASE <name> EXIT <code>".
param(
  [ValidateSet('gen', 'full', 'zip')][string]$Phase = 'full',
  [switch]$WriteArgs,
  [string]$Tag = ''
)
$ErrorActionPreference = 'Continue'
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'
$env:PATH = "C:\depot_tools;$env:PATH"
if (-not $env:vs2022_install) { $env:vs2022_install = 'C:\BuildTools' }
Set-Location C:\electron\src
$driver = 'C:\electron\build_r_driver.log'
function Log([string]$msg) { Add-Content -Path $driver -Value "$(Get-Date -Format s) $msg" }
$suffix = if ($Tag) { "_$Tag" } else { '' }
Log "=== phase $Phase$suffix started, pid $PID"

switch ($Phase) {
  'gen' {
    if ($WriteArgs) {
      $args_gn = @(
        'import("//electron/build/args/release.gn")',
        'is_official_build = true',
        'use_remoteexec = false',
        'use_reclient = false',
        '',
        '# src/electron carries the series'' local commits, so the version would',
        '# otherwise come out of git describe as 45.4.1-<n>-g<sha>.',
        'override_electron_version = "45.4.1"'
      )
      New-Item -ItemType Directory -Force out\Release | Out-Null
      [IO.File]::WriteAllLines('C:\electron\src\out\Release\args.gn', $args_gn)
      Log "wrote out\Release\args.gn"
    }
    $log = "C:\electron\gn_gen_r$suffix.log"
    cmd /c "buildtools\win\gn.exe gen out\Release > `"$log`" 2>&1"
  }
  'full' {
    $log = "C:\electron\build_r_full$suffix.log"
    # -k 0: DCHECK-off and official-only errors (unused fields, OFFICIAL_BUILD
    # code) would only show up here, and all of them should come in one pass.
    cmd /c "autoninja -C out\Release -k 0 electron > `"$log`" 2>&1"
  }
  'zip' {
    $log = "C:\electron\build_r_zip$suffix.log"
    cmd /c "autoninja -C out\Release electron:electron_dist_zip > `"$log`" 2>&1"
  }
}
$code = $LASTEXITCODE
Log "PHASE $Phase$suffix EXIT $code (log $log)"
