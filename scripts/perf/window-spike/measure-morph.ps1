<#
.SYNOPSIS
  W6 · strip ↔ panel morph frame rate over N morphs (per notch window).
.DESCRIPTION
  Runs the spike with MUNA_SPIKE_MORPHS=N. The UI samples requestAnimationFrame during each
  spring and reports frames, duration, longest frame and frames longer than 1.5 × 16.7 ms via
  `report_morph`; the spike logs them as `morph` events. Pass: every morph ≥ 58 fps and no
  frame > 32 ms.
#>
param([int]$Morphs = 20)
. (Join-Path $PSScriptRoot 'common.ps1')

$process = Start-Spike -Env @{ MUNA_SPIKE_MORPHS = $Morphs }
[void](Wait-SpikeEvent -Event ready -Where { $_.label -eq 'notch' } -TimeoutMs 20000)
# Keep the cursor away so hit-test toggles do not interleave with the morphs.
[void][MunaSpike.Native]::SetCursorPos(200, 1400)
$expectedPeriodMs = 1200
[void](Wait-SpikeEvent -Event morphs_done -TimeoutMs (10000 + $Morphs * $expectedPeriodMs * 2))
$reports = @(Read-SpikeLog | Where-Object { $_.event -eq 'morph' })
Stop-Spike

$byLabel = $reports | Group-Object label | ForEach-Object {
  $fps = $_.Group | ForEach-Object { [double]$_.fps }
  $maxFrame = $_.Group | ForEach-Object { [double]$_.maxFrameMs }
  [pscustomobject]@{
    label = $_.Name
    morphs = $_.Count
    minFps = [math]::Round(($fps | Measure-Object -Minimum).Minimum, 1)
    medianFps = [math]::Round((Get-Median $fps), 1)
    maxFrameMs = [math]::Round(($maxFrame | Measure-Object -Maximum).Maximum, 1)
    droppedFrames = ($_.Group | Measure-Object -Property droppedFrames -Sum).Sum
    expandMedianMs = [math]::Round((Get-Median ($_.Group | Where-Object { $_.expanded } | ForEach-Object { [double]$_.durationMs })), 1)
    collapseMedianMs = [math]::Round((Get-Median ($_.Group | Where-Object { -not $_.expanded } | ForEach-Object { [double]$_.durationMs })), 1)
  }
}
$byLabel | Format-Table | Out-String | Write-Host
$summary = [pscustomobject]@{
  criterion = 'W6'
  budgets = @{ minFps = 58; maxFrameMs = 32 }
  requested = $Morphs
  perWindow = $byLabel
  pass = @($byLabel | Where-Object { $_.minFps -lt 58 -or $_.maxFrameMs -gt 32 }).Count -eq 0
  raw = $reports
}
Save-Result -Name 'w6-morph' -Data $summary
