# Runs cap-toggle-test.js with the switches off and with c60's switch
# (KccFrameCapPreciseRelease) alone, interleaved, and sums up how much rate
# each capped window (a cap above reach) has against its uncapped neighbours.
#
#   run-cap-toggle.ps1 -Exe <electron.exe> -OutDir <dir> [-Runs 4] [-Busy 5,3]
#                      [-Variants off,precise] [-Cycles 8]
#
# Variants: off, precise (KccFrameCapPreciseRelease alone), all (every switch).
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Runs = 4,
  [string[]]$Busy = @('5'),
  [string[]]$Variants = @('off', 'precise'),
  [int]$Cycles = 8
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'kcc-flags.ps1')
New-Item -ItemType Directory -Force $OutDir | Out-Null
$summary = Join-Path $OutDir 'summary.txt'
function Note([string]$s) { Add-Content $summary $s -Encoding utf8; Write-Output $s }

$featureOf = @{ off = @(); precise = @('KccFrameCapPreciseRelease'); all = $KccAllFeatures }
$variantList = @($Variants | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$busyList = @($Busy | ForEach-Object { $_ -split ',' } | Where-Object { $_ } | ForEach-Object { [int]$_ })
foreach ($v in $variantList) { if (-not $featureOf.ContainsKey($v)) { throw "unknown variant $v" } }

$pairs = @{}
Note "# $(Get-Date -Format s)  $Exe  $Runs runs per variant and busy level, interleaved; $Cycles (capped, uncapped) cycles per run"
foreach ($b in $busyList) {
  for ($i = 1; $i -le $Runs; $i++) {
    foreach ($v in $variantList) {
      $name = "$v-busy$b-$i"
      $json = Join-Path $OutDir "$name.json"
      $log = Join-Path $OutDir "$name.log"
      if (Test-Path $json) { Remove-Item $json }
      $argv = @('cap-toggle-test.js', "--kcc-busy=$b", "--kcc-cycles=$Cycles", "--kcc-out=$json") + @(Join-KccFeatures $featureOf[$v]) + @('--enable-logging')
      if ($v -eq 'all') { $argv += "--js-flags=$KccAllJsFlags" }
      $code = Invoke-Electron $Exe $argv $log
      $crash = @(Select-String -Path $log -Pattern $KccCrashPattern).Count
      $r = if (Test-Path $json) { Get-Content $json -Raw | ConvertFrom-Json } else { $null }
      $key = "$v|busy$b"
      if (-not $pairs.ContainsKey($key)) { $pairs[$key] = New-Object System.Collections.ArrayList }
      $line = "{0,-20} exit {1}" -f $name, $code
      if ($r -and $r.pairs) {
        foreach ($p in $r.pairs) { [void]$pairs[$key].Add($p) }
        $line += '  uncapped ' + (($r.windows | Where-Object { $_.cap -eq 0 } | ForEach-Object { '{0:N0}' -f $_.fps }) -join '/')
        $line += '  capped vs neighbours ' + (($r.pairs | ForEach-Object { '{0}:{1:+0.0;-0.0}%' -f $_.cap, (($_.ratio - 1) * 100) }) -join ' ')
      } else {
        $line += '  no result'
        if ($r -and $r.events) { $line += ' (' + ($r.events -join '; ') + ')' }
      }
      if ($crash) { $line += "  CRASH LINES $crash" }
      Note $line
    }
  }
}
foreach ($key in ($pairs.Keys | Sort-Object)) {
  $r = @($pairs[$key] | ForEach-Object { [double]$_.ratio } | Sort-Object)
  if (-not $r.Count) { continue }
  $med = $r[[int][math]::Floor($r.Count / 2)]
  $mean = ($r | Measure-Object -Average).Average
  $below = @($r | Where-Object { $_ -lt 0.97 }).Count
  Note ("{0,-16} {1,3} pairs: capped vs uncapped neighbours median {2:+0.0;-0.0} %, mean {3:+0.0;-0.0} %, min {4:+0.0;-0.0} %, pairs below -3 %: {5}" -f $key, $r.Count, (($med - 1) * 100), (($mean - 1) * 100), (($r[0] - 1) * 100), $below)
}
