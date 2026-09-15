<#
.SYNOPSIS
  W11 · quiet-state detection: a fullscreen foreground window parks the strip within 1 s.
.DESCRIPTION
  A borderless window covering the whole primary monitor is shown and made foreground, which is
  what SHQueryUserNotificationState treats as a fullscreen application (QUNS_BUSY /
  QUNS_RUNNING_D3D_FULL_SCREEN). The shell polls that state every 500 ms, confirms it against
  the foreground window (QUNS_BUSY is only a hint; any full-monitor topmost overlay triggers it
  permanently) and parks. Measures the time from the window becoming foreground to the shell's
  `park` event, and from closing it to the unpark, over several cycles.
#>
param([int]$Cycles = 5)
. (Join-Path $PSScriptRoot 'common.ps1')
Add-Type -AssemblyName System.Windows.Forms

$process = Start-Spike
$form = $null
try {
  [void](Wait-SpikeEvent -Event ready -Where { $_.label -eq 'notch' } -TimeoutMs 20000)
  Start-Sleep -Milliseconds 800
  $strip = Get-PrimaryStripRect
  $primary = Get-SpikeMonitors | Where-Object { $_.isPrimary } | Select-Object -First 1
  [void][MunaSpike.Native]::SetCursorPos($strip.X + [int]($strip.Width / 2), $strip.Y + $strip.Height + 900)
  $stateBefore = Get-UserNotificationState

  $parkLatencies = @(); $unparkLatencies = @(); $failures = 0; $activations = 0
  $statesSeen = New-Object System.Collections.Generic.HashSet[string]
  for ($i = 1; $i -le $Cycles; $i++) {
    $parkCountBefore = @(Read-SpikeLog | Where-Object { $_.event -eq 'park' }).Count
    $form = New-OverlayForm -X $primary.bounds.x -Y $primary.bounds.y -Width $primary.bounds.width -Height $primary.bounds.height -Color ([System.Drawing.Color]::DarkSlateBlue)
    Show-OverlayForm $form
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    if (Set-ForegroundWindowForce $form.Handle) { $activations++ }
    $parked = $null
    while ($sw.ElapsedMilliseconds -lt 5000) {
      [void]$statesSeen.Add((Get-UserNotificationState))
      $parks = @(Read-SpikeLog | Where-Object { $_.event -eq 'park' })
      if ($parks.Count -gt $parkCountBefore -and $parks[-1].parked) { $parked = $sw.Elapsed.TotalMilliseconds; break }
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 20
    }
    $stateWhileCovered = Get-UserNotificationState
    if ($null -eq $parked) { $failures++ } else { $parkLatencies += [math]::Round($parked) }

    Start-Sleep -Milliseconds 700
    $parkCountBefore = @(Read-SpikeLog | Where-Object { $_.event -eq 'park' }).Count
    $sw.Restart()
    Close-OverlayForm $form
    $form = $null
    $unparked = $null
    while ($sw.ElapsedMilliseconds -lt 5000) {
      $parks = @(Read-SpikeLog | Where-Object { $_.event -eq 'park' })
      if ($parks.Count -gt $parkCountBefore -and -not $parks[-1].parked) { $unparked = $sw.Elapsed.TotalMilliseconds; break }
      Start-Sleep -Milliseconds 20
    }
    if ($null -eq $unparked) { $failures++ } else { $unparkLatencies += [math]::Round($unparked) }
    Write-Host ("cycle {0}: state while covered={1} park={2} ms unpark={3} ms" -f $i, $stateWhileCovered, $parked, $unparked)
    Start-Sleep -Milliseconds 800
  }

  $log = Read-SpikeLog
  $summary = [pscustomobject]@{
    criterion = 'W11'
    budgetMs = 1000
    cycles = $Cycles
    stateBefore = $stateBefore
    statesSeenWhileCovered = @($statesSeen)
    foregroundActivations = $activations
    parkMs = @{ median = Get-Median $parkLatencies; max = ($parkLatencies | Measure-Object -Maximum).Maximum; samples = $parkLatencies }
    unparkMs = @{ median = Get-Median $unparkLatencies; max = ($unparkLatencies | Measure-Object -Maximum).Maximum; samples = $unparkLatencies }
    failures = $failures
    quietStateEvents = @($log | Where-Object { $_.event -eq 'quiet_state' } | ForEach-Object { @{ t_ms = [math]::Round($_.t_ms); state = $_.state; foregroundFullscreen = $_.foregroundFullscreen; park = $_.park } })
    parkEvents = @($log | Where-Object { $_.event -eq 'park' } | ForEach-Object { @{ t_ms = [math]::Round($_.t_ms); parked = $_.parked; reason = $_.reason } })
    pass = ($failures -eq 0 -and $parkLatencies.Count -gt 0 -and (($parkLatencies | Measure-Object -Maximum).Maximum) -le 1000)
  }
  "state before: $stateBefore · while covered: $(@($statesSeen) -join ', ')"
  "park median $($summary.parkMs.median) ms (max $($summary.parkMs.max)); unpark median $($summary.unparkMs.median) ms (max $($summary.unparkMs.max)); failures $failures; pass $($summary.pass)"
  Save-Result -Name 'w11-fullscreen' -Data $summary
} finally {
  Close-OverlayForm $form
  Stop-Spike
}
