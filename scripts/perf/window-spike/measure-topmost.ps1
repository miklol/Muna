<#
.SYNOPSIS
  W12 · top-most re-assertion: the strip is back on top after a topmost window takes foreground.
.DESCRIPTION
  A red borderless topmost window is shown over the strip. Showing it activates it (a
  foreground change, EVENT_SYSTEM_FOREGROUND) and Windows raises it to the top of the topmost
  band, covering the strip. The shell re-asserts HWND_TOPMOST on the hook and again 20 ms and
  250 ms later, because the activation raise lands after the hook delivery. The harness starts
  a stopwatch at ShowWindow and polls the strip's centre pixel and the z-order until the notch
  is above the red window again. Latencies cluster either near the hook (immediate assert won
  the race) or near the first settle delay.
#>
param([int]$Trials = 10)
. (Join-Path $PSScriptRoot 'common.ps1')
Add-Type -AssemblyName System.Windows.Forms

$process = Start-Spike
$form = $null
try {
  [void](Wait-SpikeEvent -Event ready -Where { $_.label -eq 'notch' } -TimeoutMs 20000)
  Start-Sleep -Milliseconds 800
  $strip = Get-PrimaryStripRect
  $notch = Get-NotchWindows | Where-Object { $_.Left -ge 0 } | Select-Object -First 1
  $centre = @{ X = $strip.X + [int]($strip.Width / 2); Y = $strip.Y + [int]($strip.Height / 2) }
  # Cursor parked away from the window; W12 is about z-order, not hit-testing.
  [void][MunaSpike.Native]::SetCursorPos($centre.X, $strip.Y + $strip.Height + 900)
  Start-Sleep -Milliseconds 300
  if (-not (Test-NearBlack (Get-ScreenPixel $centre.X $centre.Y))) { throw 'strip centre is not black before the test' }

  $pixelLatencies = @(); $zOrderLatencies = @(); $failures = 0; $activatedOnShow = 0; $everCovered = 0
  for ($i = 1; $i -le $Trials; $i++) {
    $form = New-OverlayForm -X ($strip.X - 100) -Y 0 -Width ($strip.Width + 200) -Height ($strip.Height + 150) -TopMost
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Show-OverlayForm $form
    $covered = $false; $pixelAt = $null; $zAt = $null
    while ($sw.ElapsedMilliseconds -lt 2000 -and ($null -eq $pixelAt -or $null -eq $zAt)) {
      $black = Test-NearBlack (Get-ScreenPixel $centre.X $centre.Y)
      if (-not $black) { $covered = $true }
      if ($null -eq $pixelAt -and $covered -and $black) { $pixelAt = $sw.Elapsed.TotalMilliseconds }
      if ($null -eq $zAt) {
        $order = Get-ZOrder
        $notchIndex = [array]::IndexOf($order, $notch.Hwnd)
        $formIndex = [array]::IndexOf($order, $form.Handle)
        if ($notchIndex -ge 0 -and $formIndex -ge 0 -and $notchIndex -lt $formIndex -and $covered) { $zAt = $sw.Elapsed.TotalMilliseconds }
      }
      [System.Windows.Forms.Application]::DoEvents()
    }
    if ([MunaSpike.Native]::GetForegroundWindow() -eq $form.Handle) { $activatedOnShow++ }
    if ($covered) { $everCovered++ }
    if ($null -eq $pixelAt -or $null -eq $zAt) { $failures++ }
    if ($null -ne $pixelAt) { $pixelLatencies += [math]::Round($pixelAt, 2) }
    if ($null -ne $zAt) { $zOrderLatencies += [math]::Round($zAt, 2) }
    Write-Host ("trial {0}: covered={1} pixel back={2} ms z-order back={3} ms" -f $i, $covered, $pixelAt, $zAt)
    Close-OverlayForm $form
    $form = $null
    Start-Sleep -Milliseconds 600
  }

  $log = Read-SpikeLog
  $foregroundEvents = @($log | Where-Object { $_.event -eq 'foreground' -and $_.phase -eq 'immediate' })
  $summary = [pscustomobject]@{
    criterion = 'W12'
    budget = 'strip back on top within one frame of EVENT_SYSTEM_FOREGROUND; the shell asserts on the hook and again after 20 ms and 250 ms'
    trials = $Trials
    overlayActivatedOnShow = $activatedOnShow
    stripCoveredAtSomePoint = $everCovered
    pixelBlackAgainMs = @{ median = Get-Median $pixelLatencies; p95 = Get-Percentile $pixelLatencies 95; max = ($pixelLatencies | Measure-Object -Maximum).Maximum; samples = $pixelLatencies }
    zOrderAboveMs = @{ median = Get-Median $zOrderLatencies; p95 = Get-Percentile $zOrderLatencies 95; max = ($zOrderLatencies | Measure-Object -Maximum).Maximum; samples = $zOrderLatencies }
    failures = $failures
    foregroundEventsSeenByShell = $foregroundEvents.Count
    note = 'stopwatch starts at ShowWindow: includes activation, hook delivery, the shell SetWindowPos and the GetPixel poll'
  }
  "overlay activated on show: $activatedOnShow / $Trials · strip covered at some point: $everCovered / $Trials"
  "strip back on top: pixel median $($summary.pixelBlackAgainMs.median) ms (p95 $($summary.pixelBlackAgainMs.p95), max $($summary.pixelBlackAgainMs.max)); z-order median $($summary.zOrderAboveMs.median) ms; failures $failures"
  "foreground events seen by the shell: $($foregroundEvents.Count)"
  Save-Result -Name 'w12-topmost' -Data $summary
} finally {
  Close-OverlayForm $form
  Stop-Spike
}
