<#
.SYNOPSIS
  W1 · flashes over N park/unpark cycles of the primary strip.
.DESCRIPTION
  Runs the spike with MUNA_SPIKE_CYCLES=N (park = window moved fully above its monitor,
  unpark = back to top-centre, every 250 ms starting 2 s after ready). Records the strip
  region at capture speed and applies the W1 rule from docs/spikes/m0-window.md: a frame
  that differs from both neighbours by > 2 % of pixels is a flash. Expect ≈ 2 × N transitions
  and 0 flashes.
#>
param([int]$Cycles = 100)
. (Join-Path $PSScriptRoot 'common.ps1')

$process = Start-Spike -Env @{ MUNA_SPIKE_CYCLES = $Cycles }
[void](Wait-SpikeEvent -Event ready -Where { $_.label -eq 'notch' } -TimeoutMs 20000)
[void][MunaSpike.Native]::SetCursorPos(200, 1400)
Start-Sleep -Milliseconds 500
$strip = Get-PrimaryStripRect
Write-Host "recording strip $($strip | ConvertTo-Json -Compress) during $Cycles cycles…"
$recording = Record-StripFlashes -Rect $strip -Name 'w1' -MaxSeconds (20 + $Cycles) -Until {
  @(Read-SpikeLog | Where-Object { $_.event -eq 'cycles_done' }).Count -gt 0
}
$log = Read-SpikeLog
Stop-Spike

$parks = @($log | Where-Object { $_.event -eq 'park' })
$summary = [pscustomobject]@{
  criterion = 'W1'
  budgetFlashes = 0
  cycles = $Cycles
  parkEvents = $parks.Count
  recording = $recording
  pass = ($recording.flashes -eq 0 -and $recording.transitions -ge $Cycles)
}
$recording | Select-Object frames, seconds, captureHz, captureErrors, transitions, flashes, placedFrames, otherFrames, maxBrightness | Format-List | Out-String | Write-Host
Save-Result -Name 'w1-park-cycles' -Data $summary
