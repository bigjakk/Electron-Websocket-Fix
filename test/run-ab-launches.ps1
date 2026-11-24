# Two builds compared over several launches each, on run-krunker-ab.ps1.
#
#   run-ab-launches.ps1 -ExeA <electron.exe> -ExeB <electron.exe> -OutDir <dir>
#                       [-LabelA base] [-LabelB new] [-Launches 6] [-Minutes 1]
#                       [-Scene menu|match] [-Switches on|off] [-ProfileDir <dir>]
#                       [-SkipSeconds 20] [-SummaryOnly] [-Exclude <label>,...]
#
# Why several launches: on the gaming PC a launch lands in one of two speed
# states (about 0.12 ms a frame apart) whatever the build or switches, so one
# launch per build says nothing. Launches alternate A B B A A B B A ... so slow
# drift (temperature, background work) falls on both builds alike.
#
# -Scene menu   nobody plays: every launch sits on the game's menu for -Minutes
#               and quits by itself. The first -SkipSeconds of each launch
#               (page load, shader warm-up) are left out. The menu draws a
#               live match from a fixed camera, on whatever map the matchmaker
#               picked, so launches differ by map. A picture of each launch's
#               last frame is saved (it names the map): look at them before
#               trusting the summary. A launch can end up on the site's
#               "Verify you are human" check with no 3D scene at all (about
#               1,700 fps on the gaming PC; seen on 2026-11-24 after some
#               twenty launches in half an hour).
#               Leave such launches out with -SummaryOnly -Exclude, do not
#               answer the check from a script, and do not run long series:
#               repeated automated launches are a likely cause of the check.
# -Scene match  a person plays every launch (-Minutes 0: quit with F10); only
#               the frames with the pointer locked count. Play the same thing
#               every time, and write down the map and mode of each launch:
#               no picture is saved in a match.
# -SummaryOnly  no launches: print the summary of the result files in -OutDir.
#
# Per launch the figure is the mean of the harness's 2-second windows (frames
# per second, uncapped). The last lines give each build's launches, the
# difference between the means and how often a random relabelling of the same
# launches gives a difference at least that large (a permutation test; small =
# the difference is not the launch-to-launch spread). Few launches cannot give
# a small figure whatever the builds do: with three a side the lowest possible
# is 10 % (2 of the 20 ways to split six launches), and the line says so.
#
# A locked desktop still renders with these switches, but nothing is shown, so
# presenting costs less than in play: every launch is printed with whether the
# lock screen was up, and a series should be all one or all the other.
param(
  [Parameter(Mandatory = $true)][string]$ExeA,
  [Parameter(Mandatory = $true)][string]$ExeB,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$LabelA = 'base',
  [string]$LabelB = 'new',
  [int]$Launches = 6,
  [double]$Minutes = 1,
  [ValidateSet('menu', 'match')][string]$Scene = 'menu',
  [ValidateSet('off', 'on')][string]$Switches = 'on',
  [string]$ProfileDir = '',
  [double]$SkipSeconds = 20,
  [switch]$SummaryOnly,
  # Launches to leave out of the summary, by label (base-3, new-1).
  [string[]]$Exclude = @()
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$series = Join-Path $OutDir 'series.txt'
function Note([string]$s) { Add-Content $series $s -Encoding utf8; Write-Output $s }

if (-not $SummaryOnly) {
  if (Get-ChildItem $OutDir -Filter 'ab-*.json') { throw "$OutDir already holds result files: give every series its own folder" }
  Note "== $(Get-Date -Format s)  scene $Scene, $Launches launches each, $Minutes min, switches $Switches"
  Note "   A $LabelA = $ExeA"
  Note "   B $LabelB = $ExeB"
  $order = for ($i = 0; $i -lt 2 * $Launches; $i++) { if (($i % 4) -in 0, 3) { 'A' } else { 'B' } }
  $count = @{ A = 0; B = 0 }
  foreach ($arm in $order) {
    $count[$arm]++
    $label = "$(if ($arm -eq 'A') { $LabelA } else { $LabelB })-$($count[$arm])"
    $exe = if ($arm -eq 'A') { $ExeA } else { $ExeB }
    $locked = [bool](Get-Process LogonUI -ErrorAction SilentlyContinue)
    # On the menu a picture of each launch's last frame shows which launches
    # did not sit on the same scene.
    $run = @{ Exe = $exe; Label = $label; OutDir = $OutDir; Switches = $Switches; Minutes = $Minutes; Screenshot = ($Scene -eq 'menu') }
    if ($ProfileDir) { $run.ProfileDir = $ProfileDir }
    $out = & (Join-Path $PSScriptRoot 'run-krunker-ab.ps1') @run 2>&1 | ForEach-Object { "$_" }
    Note "$(Get-Date -Format HH:mm:ss)  $label  lock screen $(if ($locked) { 'up' } else { 'not up' })  $(($out | Where-Object { $_ -match '^exit ' }) -join ' ')"
    Start-Sleep -Seconds 3
  }
}

# Per launch: the windows that count, their mean rate and their slowest frames.
function Read-Launch([string]$file) {
  $j = Get-Content $file -Raw | ConvertFrom-Json
  $w = @($j.windows | Where-Object { $_.cap -eq 'uncapped' -and $_.inMatch -eq ($Scene -eq 'match') -and ($Scene -eq 'match' -or $_.t -ge $SkipSeconds) })
  if ($w.Count -eq 0) { return $null }
  [pscustomobject]@{
    Label   = $j.label
    Windows = $w.Count
    Fps     = [math]::Round(($w | Measure-Object fps -Average).Average, 1)
    P99Ms   = [math]::Round(($w | Measure-Object p99Ms -Average).Average, 2)
    MaxMs   = ($w | Measure-Object maxMs -Maximum).Maximum
  }
}
$leftOut = [Collections.Generic.List[string]]::new()
function Read-Arm([string]$label) {
  $rows = @()
  foreach ($f in (Get-ChildItem $OutDir -Filter "ab-$label-*.json" | Sort-Object LastWriteTime)) {
    if ($f.Name -notmatch "^ab-($([regex]::Escape($label))-\d+)-\d{4}-") { continue }
    if ($Matches[1] -in $Exclude) { $leftOut.Add("   $($Matches[1]): left out (-Exclude)"); continue }
    $r = Read-Launch $f.FullName
    if ($r) { $rows += $r } else { $leftOut.Add("   $($f.Name): no $Scene frames, left out") }
  }
  return $rows
}
function Mean([double[]]$x) { ($x | Measure-Object -Average).Average }
function Median([double[]]$x) { $s = @($x | Sort-Object); $n = $s.Count; if ($n % 2) { $s[($n - 1) / 2] } else { ($s[$n / 2 - 1] + $s[$n / 2]) / 2 } }

$a = @(Read-Arm $LabelA)
$b = @(Read-Arm $LabelB)
foreach ($s in $leftOut) { Note $s }
Note "-- $Scene scene, frames per second per launch (mean of 2 s windows$(if ($Scene -eq 'menu') { ", first $SkipSeconds s left out" }))"
foreach ($arm in @(@($LabelA, $a), @($LabelB, $b))) {
  foreach ($r in $arm[1]) { Note ("   {0,-14} {1,8:N1} fps   99th-percentile frame {2,5:N2} ms   slowest {3,6:N1} ms   {4} windows" -f $r.Label, $r.Fps, $r.P99Ms, $r.MaxMs, $r.Windows) }
}
if ($a.Count -lt 2 -or $b.Count -lt 2) { Note '   fewer than 2 launches on one side: no comparison'; return }
$fa = [double[]]($a | ForEach-Object Fps)
$fb = [double[]]($b | ForEach-Object Fps)
foreach ($arm in @(@($LabelA, $fa), @($LabelB, $fb))) {
  $v = [double[]]$arm[1]
  Note ("   {0,-8} n={1}  mean {2,8:N1}  median {3,8:N1}  lowest {4,8:N1}  highest {5,8:N1}" -f $arm[0], $v.Count, (Mean $v), (Median $v), ($v | Measure-Object -Minimum).Minimum, ($v | Measure-Object -Maximum).Maximum)
}
$diff = (Mean $fb) - (Mean $fa)
# Permutation test on the difference of means: 20,000 random relabellings.
$all = [double[]]($fa + $fb)
$n = $all.Count
$total = ($all | Measure-Object -Sum).Sum
$rng = [Random]::new(12345)
$hits = 0
$rounds = 20000
for ($k = 0; $k -lt $rounds; $k++) {
  # The first $fa.Count places of a shuffle are the relabelled A launches.
  $sa = 0.0
  for ($i = 0; $i -lt $fa.Count; $i++) {
    $j = $rng.Next($i, $n)
    $t = $all[$i]; $all[$i] = $all[$j]; $all[$j] = $t
    $sa += $all[$i]
  }
  if ([math]::Abs(($total - $sa) / $fb.Count - $sa / $fa.Count) -ge [math]::Abs($diff) - 1e-9) { $hits++ }
}
# The lowest figure this many launches can give: the split that was run, and
# its mirror image when both sides have as many launches.
$ways = 1.0
for ($i = 1; $i -le $fa.Count; $i++) { $ways = $ways * ($n - $fa.Count + $i) / $i }
$floor = 100 * $(if ($fa.Count -eq $fb.Count) { 2 } else { 1 }) / $ways
Note ("   {0} against {1}: {2:+0.0;-0.0} fps on the means ({3:+0.0;-0.0} %), medians {4:+0.0;-0.0} %; a random relabelling does as well in {5:N1} % of {6} tries (lowest possible with {7} and {8} launches: {9:0.##} %)" -f $LabelB, $LabelA, $diff, (100 * $diff / (Mean $fa)), (100 * ((Median $fb) / (Median $fa) - 1)), (100 * $hits / $rounds), $rounds, $fa.Count, $fb.Count, $floor)
