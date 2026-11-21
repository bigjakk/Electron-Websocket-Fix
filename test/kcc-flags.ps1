# Shared by the gate and check drivers: the switches of the KCC Electron 45
# series, exactly as patches/electron-45/README.md lists them under
# "Everything on". Chromium keeps only the LAST --enable-features switch, so
# callers merge their own features into one value with Join-KccFeatures.

$KccAllFeatures = @(
  'KccNoPointerLockEscCooldown', 'KccPinRawPointerLock', 'KccRawInputKeepWheelMotion',
  'KccRawInputFastPath', 'KccLeanLockedMouseMove', 'KccSkipUnobservedInputEmits',
  'KccSkipCanvasPerfSampling', 'KccLabelTexturesOnce', 'KccCacheVsyncInterval',
  'KccMacFineGpuBackpressure', 'KccAudioParamCoalesce', 'KccHrtfPannerKRateAngles',
  'KccX11AllowUnredirect', 'KccX11RawMouse', 'KccFrameCapPreciseRelease'
)
# KccFrameCapLateLatch (c61) was dropped from the series on 2026-11-21 (see
# patches/electron-45/RESULTS.md); Stage 2 tested it on the 23-patch build.
$KccAllJsFlags = '--cppheap-max-incremental-sweep-duration-ms=1'

function Join-KccFeatures([string[]]$features) {
  $list = @($features | Where-Object { $_ })
  if ($list.Count -eq 0) { return @() }
  return @("--enable-features=$($list -join ',')")
}

# Waits until no process of this electron.exe (browser or child) is left, so
# that one run's GPU or renderer process never overlaps the next run, and the
# log handle the children inherited is closed. Returns how many are left.
function Wait-ElectronGone([string]$exe, [int]$timeoutMs = 20000) {
  $full = [IO.Path]::GetFullPath($exe)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  do {
    $left = @(Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $full })
    if ($left.Count -eq 0) { return 0 }
    Start-Sleep -Milliseconds 200
  } while ($sw.ElapsedMilliseconds -lt $timeoutMs)
  return $left.Count
}

# Runs electron with the given arguments from the test directory, stdout and
# stderr both into $log, and returns the exit code. cmd /c keeps native stderr
# out of PowerShell's error stream.
function Invoke-Electron([string]$exe, [string[]]$argv, [string]$log) {
  $quoted = ($argv | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  Set-Content -Path $log -Value "# $(Get-Date -Format s)  $exe $quoted" -Encoding utf8
  Push-Location $PSScriptRoot
  try {
    cmd /c "`"$exe`" $quoted >> `"$log`" 2>&1"
    $code = $LASTEXITCODE
  } finally { Pop-Location }
  $left = Wait-ElectronGone $exe
  $line = "# exit $code  $(Get-Date -Format s)$(if ($left) { "  ($left electron processes still running 20 s after the browser exited)" })"
  for ($i = 0; $i -lt 40; $i++) {
    try { Add-Content -Path $log -Value $line -Encoding utf8 -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 250 }
  }
  return $code
}

# DCHECK / CHECK failures and crashes that a log can show. Case-sensitive
# ((?-i); Select-String ignores case by default): "WATCHDOG" is what the test
# scripts log when they time out, and must not match Chromium's GpuWatchdog
# thread in the cpu suite's thread list.
$KccCrashPattern = '(?-i)Check failed|DCHECK failed|NOTREACHED|FATAL:|child-process-gone|render-process-gone|HARNESS ERROR|\bWATCHDOG\b'
