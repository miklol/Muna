<#
.SYNOPSIS
  W2 / W9 / W10 - monitor topology, per-monitor scale and resolution changes.
.DESCRIPTION
  Drives the display configuration the way a user would (Win+P style topology switch, the
  Settings scale slider, a resolution change) while the spike is running, and records how the
  shell reacts: display_change events, windows destroyed/created, moves, scale-factor events,
  the resulting strip geometry, and strip flashes on the primary while the topology changes.

  Phases (each restores what it changed; everything is restored again in `finally`):
    1. W10  primary scale: original -> each of -ScaleSequence -> original, -ScaleCycles times.
    2. W2   secondary resolution: current -> -SecondaryResolution -> current, -ResolutionCycles times.
    3. W9   hot-plug: DisplaySwitch /internal (secondary removed) then /extend, -HotplugCycles times.

  Disruptive: the primary re-scales and the secondary disappears for a few seconds per cycle.
  Run it with nothing important open on the secondary monitor.
#>
param(
  [int]$HotplugCycles = 5,
  [int]$ScaleCycles = 2,
  [int]$ResolutionCycles = 3,
  [string]$Primary = '\\.\DISPLAY1',
  [string]$Secondary = '\\.\DISPLAY5',
  [int[]]$ScaleSequence = @(200, 100),
  [int[]]$SecondaryResolution = @(1600, 900),
  [int]$SettleMs = 4000
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'display.ps1')

$stripDip = @{ Width = 200; Height = 32 }

<# Events appended after the first $Skip lines. #>
function Get-NewEvents([int]$Skip, [string]$Event) {
  @(Read-SpikeLog | Select-Object -Skip $Skip | Where-Object { $_.event -eq $Event })
}

function Wait-NewEvent {
  param([int]$Skip, [string]$Event, [scriptblock]$Where = { $true }, [int]$TimeoutMs = 15000, [int]$MinCount = 1)
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    $found = @(Get-NewEvents $Skip $Event | Where-Object $Where)
    if ($found.Count -ge $MinCount) { return $found }
    Start-Sleep -Milliseconds 25
  }
  throw "Timed out after ${TimeoutMs} ms waiting for new '$Event' event."
}

<# Runs a display.ps1 action in another process so this one can keep capturing frames. #>
function Start-DisplayAction([string]$Action, [object[]]$Arguments) {
  Start-Job -ScriptBlock {
    param($dir, $action, $arguments)
    . (Join-Path $dir 'display.ps1')
    & $action @arguments
  } -ArgumentList $PSScriptRoot, $Action, $Arguments
}

<# Records primary-strip flashes while a background job runs, then for $SettleMs after it ends. #>
function Record-During([System.Management.Automation.Job]$Job, $Rect, [string]$Name) {
  $script:doneAt = $null
  $recording = Record-StripFlashes -Rect $Rect -Name $Name -MaxSeconds 60 -Until {
    if ($Job.State -eq 'Running' -or $Job.State -eq 'NotStarted') { return $false }
    if ($null -eq $script:doneAt) { $script:doneAt = [DateTime]::UtcNow }
    ([DateTime]::UtcNow - $script:doneAt).TotalMilliseconds -ge $SettleMs
  }
  $output = Receive-Job $Job -ErrorAction Stop
  Remove-Job $Job -Force
  if ($null -ne $output) { $output | Out-String | Write-Verbose }
  $recording
}

function Get-MonitorById([string]$Id) {
  Get-SpikeMonitors | Where-Object { $_.id -eq $Id } | Select-Object -First 1
}

<# Last placed (not parked) window rect per label, from `moved` events since $Skip. #>
function Get-PlacedRect([int]$Skip, [string]$Label) {
  $moves = @(Get-NewEvents $Skip 'moved' | Where-Object { $_.label -eq $Label -and -not $_.parked })
  if ($moves.Count -eq 0) { return $null }
  $moves[-1].rect
}

function Test-RectInside($Inner, $Outer) {
  $Inner.x -ge $Outer.x -and $Inner.y -ge $Outer.y -and
  ($Inner.x + $Inner.width) -le ($Outer.x + $Outer.width) -and
  ($Inner.y + $Inner.height) -le ($Outer.y + $Outer.height)
}

function Expected-Strip([int]$Percent, $Monitor) {
  $w = [int][math]::Round($stripDip.Width * $Percent / 100.0)
  $h = [int][math]::Round($stripDip.Height * $Percent / 100.0)
  [pscustomobject]@{
    X = [int]$Monitor.bounds.x + [int][math]::Floor(([int]$Monitor.bounds.width - $w) / 2)
    Y = [int]$Monitor.bounds.y
    Width = $w
    Height = $h
  }
}

$originalScale = (Get-DisplayScale $Primary).Current
$originalMode = Get-DisplayMode $Secondary
$originalPaths = @(Get-DisplayPaths)
Write-Host "primary $Primary at $originalScale %, secondary $Secondary at $($originalMode.dmPelsWidth)x$($originalMode.dmPelsHeight), $($originalPaths.Count) displays"

$scaleRuns = New-Object System.Collections.Generic.List[object]
$resolutionRuns = New-Object System.Collections.Generic.List[object]
$hotplugRuns = New-Object System.Collections.Generic.List[object]
$changesIssued = 0
$process = $null

try {
  $process = Start-Spike
  [void](Wait-SpikeEvent -Event ready -TimeoutMs 20000 -MinCount $originalPaths.Count)
  Start-Sleep -Milliseconds 1500
  $baseline = Get-PrimaryStripRect
  $primaryMonitor = Get-SpikeMonitors | Where-Object { $_.isPrimary } | Select-Object -First 1
  Write-Host "baseline strip ($($baseline.X),$($baseline.Y)) $($baseline.Width)x$($baseline.Height), primary dpi $($primaryMonitor.dpi)"

  # ---- Phase 1: W10 primary scale ---------------------------------------------------------
  $sequence = @($ScaleSequence + $originalScale)
  for ($cycle = 1; $cycle -le $ScaleCycles; $cycle++) {
    foreach ($percent in $sequence) {
      $skip = @(Read-SpikeLog).Count
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      Set-DisplayScale $Primary $percent
      $changesIssued++
      $entry = [ordered]@{ cycle = $cycle; percent = $percent; ok = $false }
      try {
        $sfc = Wait-NewEvent -Skip $skip -Event scale_factor_changed -Where { $_.label -eq 'notch' } -TimeoutMs 15000
        $entry.scaleEventMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
        $entry.scaleFactor = $sfc[-1].scaleFactor
        [void](Wait-NewEvent -Skip $skip -Event moved -Where { $_.label -eq 'notch' -and -not $_.parked } -TimeoutMs 15000)
        $strip = Get-PrimaryStripRect -TimeoutMs 10000
        $entry.placedMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
        Start-Sleep -Milliseconds 1500
        $monitor = Get-SpikeMonitors | Where-Object { $_.isPrimary } | Select-Object -First 1
        $expected = Expected-Strip $percent $monitor
        $windows = @(Get-NotchWindows | Where-Object { $_.Left -ge [int]$monitor.bounds.x -and $_.Left -lt ([int]$monitor.bounds.x + [int]$monitor.bounds.width) })
        $windowDpi = if ($windows.Count -gt 0) { [MunaSpike.Native]::GetDpiForWindow([IntPtr]$windows[0].Hwnd) } else { 0 }
        $bmp = Capture-Region $strip.X $strip.Y $strip.Width $strip.Height
        try {
          $black = Get-BlackFraction (Get-BitmapBytes $bmp)
          $bmp.Save((Join-Path $script:ResultsDir "w10-scale-$percent-c$cycle.png"))
        } finally { $bmp.Dispose() }
        $entry.monitorDpi = $monitor.dpi
        $entry.windowDpi = $windowDpi
        $entry.strip = "$($strip.X),$($strip.Y) $($strip.Width)x$($strip.Height)"
        $entry.expected = "$($expected.X),$($expected.Y) $($expected.Width)x$($expected.Height)"
        $entry.blackFraction = [math]::Round($black, 3)
        $entry.moves = @(Get-NewEvents $skip 'moved' | Where-Object { $_.label -eq 'notch' }).Count
        $entry.displayChanges = @(Get-NewEvents $skip 'display_change').Count
        $entry.destroyed = @(Get-NewEvents $skip 'window_destroyed').Count
        $entry.ok = ($monitor.dpi -eq [int](96 * $percent / 100)) -and ($windowDpi -eq $monitor.dpi) -and
          ($strip.X -eq $expected.X) -and ($strip.Width -eq $expected.Width) -and ($strip.Height -eq $expected.Height) -and
          ($black -ge 0.9) -and ($entry.destroyed -eq 0)
      } catch {
        $entry.error = $_.Exception.Message
      }
      $scaleRuns.Add([pscustomobject]$entry)
      Write-Host ("scale {0,3} %: event {1} ms, placed {2} ms, dpi {3}/{4}, strip {5} (expected {6}), black {7}, ok {8}{9}" -f
        $percent, $entry['scaleEventMs'], $entry['placedMs'], $entry['monitorDpi'], $entry['windowDpi'], $entry['strip'], $entry['expected'], $entry['blackFraction'], $entry.ok,
        $(if ($entry.Contains('error')) { " error: $($entry.error)" } else { '' }))
    }
  }

  # ---- Phase 2: W2 secondary resolution ----------------------------------------------------
  $secondaryMonitor = Get-SpikeMonitors | Where-Object { -not $_.isPrimary } | Select-Object -First 1
  $secondaryId = if ($null -ne $secondaryMonitor) { $secondaryMonitor.id } else { $null }
  $resolutions = @(
    @{ Width = $SecondaryResolution[0]; Height = $SecondaryResolution[1] },
    @{ Width = [int]$originalMode.dmPelsWidth; Height = [int]$originalMode.dmPelsHeight }
  )
  for ($cycle = 1; $cycle -le $ResolutionCycles; $cycle++) {
    foreach ($res in $resolutions) {
      $skip = @(Read-SpikeLog).Count
      $job = Start-DisplayAction 'Set-DisplayResolution' @($Secondary, $res.Width, $res.Height)
      $changesIssued++
      $recording = Record-During $job $baseline "w2-res-$($res.Width)-c$cycle"
      $entry = [ordered]@{ cycle = $cycle; resolution = "$($res.Width)x$($res.Height)"; ok = $false }
      try {
        $entry.displayChanges = @(Get-NewEvents $skip 'display_change').Count
        $monitor = Get-MonitorById $secondaryId
        $entry.monitorBounds = "$($monitor.bounds.x),$($monitor.bounds.y) $($monitor.bounds.width)x$($monitor.bounds.height)"
        $attached = @(Read-SpikeLog | Where-Object { $_.event -eq 'window_attached' -and $_.monitor -eq $secondaryId })
        $label = $attached[-1].label
        $rect = Get-PlacedRect $skip $label
        $entry.window = $label
        $entry.windowRect = if ($null -ne $rect) { "$($rect.x),$($rect.y) $($rect.width)x$($rect.height)" } else { 'no move' }
        $entry.flashes = $recording.flashes
        $entry.otherFrames = $recording.otherFrames
        $entry.frames = $recording.frames
        $entry.captureErrors = $recording.captureErrors
        $entry.ok = ($entry.displayChanges -ge 1) -and ([int]$monitor.bounds.width -eq $res.Width) -and
          ($null -ne $rect) -and (Test-RectInside $rect $monitor.bounds) -and ($recording.flashes -eq 0)
      } catch {
        $entry.error = $_.Exception.Message
      }
      $resolutionRuns.Add([pscustomobject]$entry)
      Write-Host ("resolution {0}: display_change x{1}, monitor {2}, {3} at {4}, flashes {5}, non-black frames {6}/{7}, ok {8}{9}" -f
        $entry.resolution, $entry['displayChanges'], $entry['monitorBounds'], $entry['window'], $entry['windowRect'], $entry['flashes'], $entry['otherFrames'], $entry['frames'], $entry.ok,
        $(if ($entry.Contains('error')) { " error: $($entry.error)" } else { '' }))
    }
  }

  # ---- Phase 3: W9 hot-plug ----------------------------------------------------------------
  for ($cycle = 1; $cycle -le $HotplugCycles; $cycle++) {
    foreach ($mode in @('internal', 'extend')) {
      $skip = @(Read-SpikeLog).Count
      $labelsBefore = @(Get-SpikeMonitors | ForEach-Object { $_.id })
      $job = Start-DisplayAction 'Set-DisplayTopology' @($mode)
      $changesIssued++
      $recording = Record-During $job $baseline "w9-$mode-c$cycle"
      $entry = [ordered]@{ cycle = $cycle; mode = $mode; ok = $false }
      try {
        $entry.displayChanges = @(Get-NewEvents $skip 'display_change').Count
        $monitors = @(Get-SpikeMonitors)
        $entry.monitors = $monitors.Count
        $entry.destroyed = @(Get-NewEvents $skip 'window_destroyed' | ForEach-Object { $_.label })
        $entry.attached = @(Get-NewEvents $skip 'window_attached' | ForEach-Object { $_.label })
        $entry.createErrors = @(Get-NewEvents $skip 'window_create_error').Count
        $entry.flashes = $recording.flashes
        $entry.otherFrames = $recording.otherFrames
        $entry.frames = $recording.frames
        $entry.captureErrors = $recording.captureErrors
        if ($mode -eq 'internal') {
          $entry.ok = ($monitors.Count -eq 1) -and ($entry.destroyed.Count -ge 1) -and ($recording.flashes -eq 0) -and
            (@(Get-NotchWindows).Count -eq 1)
        } else {
          # Every monitor must have a ready, placed window inside its bounds.
          $placedAll = $true
          $placement = @()
          foreach ($monitor in $monitors) {
            $attachedHere = @(Read-SpikeLog | Where-Object { $_.event -eq 'window_attached' -and $_.monitor -eq $monitor.id })
            $label = $attachedHere[-1].label
            if ($label -ne 'notch') {
              [void](Wait-NewEvent -Skip $skip -Event ready -Where { $_.label -eq $label } -TimeoutMs 20000)
              [void](Wait-NewEvent -Skip $skip -Event moved -Where { $_.label -eq $label -and -not $_.parked } -TimeoutMs 10000)
            }
            $rect = Get-PlacedRect 0 $label
            $inside = ($null -ne $rect) -and (Test-RectInside $rect $monitor.bounds)
            $placement += "$label@$($monitor.id)=$(if ($inside) { 'inside' } else { 'outside' })"
            if (-not $inside) { $placedAll = $false }
          }
          $entry.placement = $placement -join ', '
          $entry.ok = ($monitors.Count -eq $originalPaths.Count) -and ($entry.attached.Count -ge 1) -and $placedAll -and
            ($recording.flashes -eq 0) -and (@(Get-NotchWindows).Count -eq $monitors.Count) -and ($entry.createErrors -eq 0)
        }
      } catch {
        $entry.error = $_.Exception.Message
      }
      $hotplugRuns.Add([pscustomobject]$entry)
      Write-Host ("hot-plug {0} c{1}: display_change x{2}, monitors {3}, destroyed [{4}], attached [{5}], flashes {6}, non-black frames {7}/{8}, ok {9}{10}" -f
        $mode, $cycle, $entry['displayChanges'], $entry['monitors'], ($entry['destroyed'] -join ' '), ($entry['attached'] -join ' '), $entry['flashes'], $entry['otherFrames'], $entry['frames'], $entry.ok,
        $(if ($entry.Contains('error')) { " error: $($entry.error)" } else { '' }))
      Start-Sleep -Milliseconds 1000
    }
  }
} finally {
  Write-Host 'restoring display configuration'
  try { if (@(Get-DisplayPaths).Count -lt $originalPaths.Count) { Set-DisplayTopology extend; Start-Sleep -Seconds 5 } } catch { Write-Warning "topology restore: $_" }
  try { Restore-DisplayResolution $Secondary } catch { Write-Warning "resolution restore: $_" }
  try { if ((Get-DisplayScale $Primary).Current -ne $originalScale) { Set-DisplayScale $Primary $originalScale } } catch { Write-Warning "scale restore: $_" }
  Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
}

$allEvents = @(Read-SpikeLog)
$totalDisplayChanges = @($allEvents | Where-Object { $_.event -eq 'display_change' }).Count
$recorded = [object[]]$resolutionRuns.ToArray() + [object[]]$hotplugRuns.ToArray()
$totalFlashes = [int](($recorded | ForEach-Object { if ($_.PSObject.Properties['flashes']) { $_.flashes } else { 0 } } | Measure-Object -Sum).Sum)
$totalFrames = [int](($recorded | ForEach-Object { if ($_.PSObject.Properties['frames']) { $_.frames } else { 0 } } | Measure-Object -Sum).Sum)
$scaleOk = @($scaleRuns | Where-Object { -not $_.ok }).Count -eq 0
$resolutionOk = @($resolutionRuns | Where-Object { -not $_.ok }).Count -eq 0
$hotplugOk = @($hotplugRuns | Where-Object { -not $_.ok }).Count -eq 0

Stop-Spike

$summary = [pscustomobject]@{
  criteria = 'W2 W9 W10'
  changesIssued = $changesIssued
  displayChangeEvents = $totalDisplayChanges
  scaleChanges = $scaleRuns.Count
  scaleRuns = $scaleRuns.ToArray()
  resolutionChanges = $resolutionRuns.Count
  resolutionRuns = $resolutionRuns.ToArray()
  hotplugChanges = $hotplugRuns.Count
  hotplugRuns = $hotplugRuns.ToArray()
  flashes = $totalFlashes
  framesRecorded = $totalFrames
  w2Pass = ($changesIssued -ge 20) -and ($totalFlashes -eq 0)
  w9Pass = $hotplugOk
  w10Pass = $scaleOk
  pass = ($changesIssued -ge 20) -and ($totalFlashes -eq 0) -and $scaleOk -and $resolutionOk -and $hotplugOk
  displays = @($originalPaths | ForEach-Object { $_.Name })
  originalScale = $originalScale
}
Write-Host "changes issued $changesIssued, display_change events $totalDisplayChanges, flashes $totalFlashes over $totalFrames frames; W10 $scaleOk, resolution $resolutionOk, W9 $hotplugOk, pass $($summary.pass)"
Save-Result -Name 'w2-w9-w10-display-changes' -Data $summary
