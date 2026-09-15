<#
.SYNOPSIS
  W7 · click-through: pointer input passes outside the published shape and lands on the strip
  inside it; measures how long the hit-test toggle takes after the cursor crosses the edge.
.DESCRIPTION
  The spike polls the cursor (10 Hz outside the window bounds, 60 Hz inside) and toggles
  WS_EX_TRANSPARENT when the cursor enters or leaves the published shape rects. This script
  moves the cursor with SetCursorPos and polls WindowFromPoint every millisecond until the
  window under the cursor flips, N times in each direction.
#>
param([int]$Trials = 20)
. (Join-Path $PSScriptRoot 'common.ps1')

$process = Start-Spike
[void](Wait-SpikeEvent -Event ready -Where { $_.label -eq 'notch' } -TimeoutMs 20000)
Start-Sleep -Milliseconds 500
$strip = Get-PrimaryStripRect
$notch = Get-NotchWindows | Where-Object { $_.Left -ge 0 } | Select-Object -First 1
$inside = @{ X = $strip.X + [int]($strip.Width / 2); Y = $strip.Y + [int]($strip.Height / 2) }
# Inside the 1000×440 DIP window, well below the strip: input must pass through here.
$outside = @{ X = $inside.X; Y = $strip.Y + $strip.Height + 200 }
if ($outside.Y -ge $notch.Bottom) { throw 'outside point is not inside the window bounds' }

function Wait-HitFlip([bool]$ExpectNotch, [hashtable]$Target, [int]$TimeoutMs = 1000) {
  # Tight loop: Start-Sleep is quantised to the 15.6 ms timer tick and would hide the latency.
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $lastCapture = -100.0
  while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    $p = New-Object MunaSpike.Native+POINT
    [void][MunaSpike.Native]::GetCursorPos([ref]$p)
    if ([math]::Abs($p.X - $Target.X) -gt 2 -or [math]::Abs($p.Y - $Target.Y) -gt 2) {
      # Physical mouse input displaced the cursor (shared machine); the trial is void.
      $script:displaced++
      return $null
    }
    $hit = Test-IsNotchWindow (Get-WindowAtPoint $p.X $p.Y)
    if ($hit -eq $ExpectNotch) { return [math]::Round($sw.Elapsed.TotalMilliseconds, 2) }
    # Frame capture rides along (at most every 4 ms) so a repaint caused by the style flip
    # shows up as a flash without dominating the detection resolution.
    if ($sw.Elapsed.TotalMilliseconds - $lastCapture -ge 4) {
      $lastCapture = $sw.Elapsed.TotalMilliseconds
      $bmp = Capture-Region $strip.X $strip.Y $strip.Width $strip.Height
      $script:captured.Add([pscustomobject]@{ t = $script:clock.Elapsed.TotalMilliseconds; bytes = (Get-BitmapBytes $bmp) })
      $bmp.Dispose()
    }
  }
  $script:failures++
  $null
}

function Capture-Settled {
  # A few frames after each move so every toggle has neighbours on both sides.
  for ($k = 0; $k -lt 3; $k++) {
    $bmp = Capture-Region $strip.X $strip.Y $strip.Width $strip.Height
    $script:captured.Add([pscustomobject]@{ t = $script:clock.Elapsed.TotalMilliseconds; bytes = (Get-BitmapBytes $bmp) })
    $bmp.Dispose()
    Start-Sleep -Milliseconds 20
  }
}

$script:captured = New-Object System.Collections.Generic.List[object]
$script:clock = [System.Diagnostics.Stopwatch]::StartNew()
$enter = @(); $leave = @(); $script:failures = 0; $script:displaced = 0
[void][MunaSpike.Native]::SetCursorPos($outside.X, $outside.Y)
Start-Sleep -Milliseconds 400
$passThroughAtStart = -not (Test-IsNotchWindow (Get-WindowAtPoint $outside.X $outside.Y))
for ($i = 1; $i -le $Trials; $i++) {
  Capture-Settled
  [void][MunaSpike.Native]::SetCursorPos($inside.X, $inside.Y)
  $latency = Wait-HitFlip $true $inside
  if ($null -ne $latency) { $enter += $latency }
  Capture-Settled
  Start-Sleep -Milliseconds 100
  [void][MunaSpike.Native]::SetCursorPos($outside.X, $outside.Y)
  $latency = Wait-HitFlip $false $outside
  if ($null -ne $latency) { $leave += $latency }
  Capture-Settled
  Start-Sleep -Milliseconds 100
}
$failures = $script:failures
$styleAfter = (Get-NotchWindows | Where-Object { $_.Hwnd -eq $notch.Hwnd }).ExStyle
$log = Read-SpikeLog
Stop-Spike

# W1 rule over the captured frames: a frame differing from both neighbours by > 2 % is a flash.
$flashes = 0; $transitions = 0; $minBlack = 1.0
for ($f = 0; $f -lt $captured.Count; $f++) {
  $black = [MunaSpike.Pixels]::BlackFraction($captured[$f].bytes, 16)
  if ($black -lt $minBlack) { $minBlack = $black }
  if ($f -eq 0) { continue }
  $dPrev = [MunaSpike.Pixels]::DiffFraction($captured[$f - 1].bytes, $captured[$f].bytes, 24)
  if ($dPrev -gt 0.02) { $transitions++ }
  if ($f + 1 -lt $captured.Count) {
    $dNext = [MunaSpike.Pixels]::DiffFraction($captured[$f].bytes, $captured[$f + 1].bytes, 24)
    if ($dPrev -gt 0.02 -and $dNext -gt 0.02) { $flashes++ }
  }
}

$summary = [pscustomobject]@{
  criterion = 'W7'
  budgetToggleMs = 16
  trials = $Trials
  insidePoint = $inside
  outsidePoint = $outside
  passThroughOutsideShapeAtStart = $passThroughAtStart
  enterMs = @{ median = Get-Median $enter; p95 = Get-Percentile $enter 95; max = ($enter | Measure-Object -Maximum).Maximum; samples = $enter }
  leaveMs = @{ median = Get-Median $leave; p95 = Get-Percentile $leave 95; max = ($leave | Measure-Object -Maximum).Maximum; samples = $leave }
  failures = $failures
  displacedTrials = $script:displaced
  pollStats = @($log | Where-Object { $_.event -eq 'poll_stats' } | ForEach-Object { @{ rate = $_.rate; nominalMs = $_.nominalMs; meanMs = [math]::Round($_.meanMs, 2); maxMs = [math]::Round($_.maxMs, 2); samples = $_.samples } })
  ignoreCursorEvents = @($log | Where-Object { $_.event -eq 'ignore_cursor' -and $_.label -eq 'notch' }).Count
  exStyleAfter = ('0x{0:X8}' -f $styleAfter)
  toolWindowKept = (($styleAfter -band 0x80) -ne 0)
  stripFramesDuringToggles = @{ frames = $captured.Count; transitions = $transitions; flashes = $flashes; minBlackFraction = [math]::Round($minBlack, 3) }
}
"enter (outside → strip): median $($summary.enterMs.median) ms, p95 $($summary.enterMs.p95) ms, max $($summary.enterMs.max) ms"
"leave (strip → outside): median $($summary.leaveMs.median) ms, p95 $($summary.leaveMs.p95) ms, max $($summary.leaveMs.max) ms"
"failures: $failures · displaced trials: $($script:displaced) · pass-through outside shape at start: $passThroughAtStart · ex-style after: $($summary.exStyleAfter) (toolWindow=$($summary.toolWindowKept))"
"poll cadence: " + (($summary.pollStats | ForEach-Object { "$($_.rate) $($_.meanMs) ms mean (nominal $($_.nominalMs))" }) -join '; ')
"strip frames during toggles: $($captured.Count), transitions: $transitions, flashes: $flashes, min black fraction: $([math]::Round($minBlack, 3))"
Save-Result -Name 'w7-hit-test' -Data $summary
