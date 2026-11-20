# Shared by the gate and check drivers: the switches of the KCC Electron 45
# series, exactly as patches/electron-45/README.md lists them under
# "Everything on". Chromium keeps only the LAST --enable-features switch, so
# callers merge their own features into one value with Join-KccFeatures.

$KccAllFeatures = @(
  'KccNoPointerLockEscCooldown', 'KccPinRawPointerLock', 'KccRawInputKeepWheelMotion',
  'KccRawInputFastPath', 'KccLeanLockedMouseMove', 'KccSkipUnobservedInputEmits',
  'KccSkipCanvasPerfSampling', 'KccLabelTexturesOnce', 'KccCacheVsyncInterval',
  'KccMacFineGpuBackpressure', 'KccAudioParamCoalesce', 'KccHrtfPannerKRateAngles',
  'KccX11AllowUnredirect', 'KccX11RawMouse', 'KccFrameCapPreciseRelease', 'KccFrameCapLateLatch'
)
$KccAllJsFlags = '--cppheap-max-incremental-sweep-duration-ms=1'

function Join-KccFeatures([string[]]$features) {
  $list = @($features | Where-Object { $_ })
  if ($list.Count -eq 0) { return @() }
  return @("--enable-features=$($list -join ',')")
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
  Add-Content -Path $log -Value "# exit $code  $(Get-Date -Format s)" -Encoding utf8
  return $code
}

# DCHECK / CHECK failures and crashes that a log can show.
$KccCrashPattern = 'Check failed|DCHECK failed|NOTREACHED|FATAL:|child-process-gone|render-process-gone|HARNESS ERROR|WATCHDOG'
