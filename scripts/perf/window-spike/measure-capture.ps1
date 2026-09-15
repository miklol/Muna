<#
.SYNOPSIS
  W8 · capture exclusion: WDA_EXCLUDEFROMCAPTURE hides the strip from screen capture.
.DESCRIPTION
  Starts the spike twice, with MUNA_SPIKE_EXCLUDE_CAPTURE unset and set, and captures the strip
  region through GDI (CopyFromScreen — the path Snipping Tool's legacy mode, PrintScreen and
  most "share screen" fallbacks use). With exclusion on, the strip must be absent (the desktop
  shows through); with it off it must be present. The Windows.Graphics.Capture path used by
  OBS, Teams and the modern Snipping Tool honours the same affinity but needs a manual check;
  the PR checklist covers it. Also records whether the affinity call itself succeeded while the
  window carries WS_EX_LAYERED (click-through state), which the docs list as a risk.
#>
param()
. (Join-Path $PSScriptRoot 'common.ps1')

function Measure-Once([bool]$Exclude, [string]$Tag) {
  $envMap = @{}
  if ($Exclude) { $envMap['MUNA_SPIKE_EXCLUDE_CAPTURE'] = '1' }
  $process = Start-Spike -Env $envMap
  try {
    [void](Wait-SpikeEvent -Event ready -Where { $_.label -eq 'notch' } -TimeoutMs 20000)
    Start-Sleep -Milliseconds 800
    $strip = Get-PrimaryStripRect
    # Cursor away from the window so the hit tester keeps it layered + transparent
    # (the common state); then a second sample with the cursor on the strip (not layered).
    [void][MunaSpike.Native]::SetCursorPos($strip.X + [int]($strip.Width / 2), $strip.Y + $strip.Height + 900)
    Start-Sleep -Milliseconds 400
    $layeredBmp = Capture-Region $strip.X $strip.Y $strip.Width $strip.Height
    $layeredBlack = Get-BlackFraction (Get-BitmapBytes $layeredBmp)
    $layeredBmp.Save((Join-Path $script:ResultsDir "w8-$Tag-layered.png"))
    $layeredBmp.Dispose()
    $exStyleLayered = (Get-NotchWindows | Where-Object { $_.Left -ge 0 } | Select-Object -First 1).ExStyle

    [void][MunaSpike.Native]::SetCursorPos($strip.X + [int]($strip.Width / 2), $strip.Y + [int]($strip.Height / 2))
    Start-Sleep -Milliseconds 400
    $plainBmp = Capture-Region $strip.X $strip.Y $strip.Width $strip.Height
    $plainBlack = Get-BlackFraction (Get-BitmapBytes $plainBmp)
    $plainBmp.Save((Join-Path $script:ResultsDir "w8-$Tag-hittable.png"))
    $plainBmp.Dispose()
    $exStylePlain = (Get-NotchWindows | Where-Object { $_.Left -ge 0 } | Select-Object -First 1).ExStyle
    [void][MunaSpike.Native]::SetCursorPos($strip.X + [int]($strip.Width / 2), $strip.Y + $strip.Height + 900)

    $log = Read-SpikeLog
    $affinity = @($log | Where-Object { $_.event -eq 'capture_exclusion' -and $_.label -eq 'notch' })
    [pscustomobject]@{
      excludeRequested = $Exclude
      affinityCalls = @($affinity | ForEach-Object { @{ excluded = $_.excluded; error = $_.error } })
      layeredState = @{ exStyle = ('0x{0:X8}' -f $exStyleLayered); stripBlackFraction = [math]::Round($layeredBlack, 3) }
      hittableState = @{ exStyle = ('0x{0:X8}' -f $exStylePlain); stripBlackFraction = [math]::Round($plainBlack, 3) }
    }
  } finally { Stop-Spike }
}

New-Item -ItemType Directory -Force -Path $script:ResultsDir | Out-Null
$off = Measure-Once $false 'off'
$on = Measure-Once $true 'on'

# Present = most of the strip rect is black; absent = the desktop shows (well under half black).
$presentOff = $off.layeredState.stripBlackFraction -gt 0.7 -and $off.hittableState.stripBlackFraction -gt 0.7
$absentOn = $on.layeredState.stripBlackFraction -lt 0.3 -and $on.hittableState.stripBlackFraction -lt 0.3
$summary = [pscustomobject]@{
  criterion = 'W8'
  method = 'GDI CopyFromScreen of the strip rect; Windows.Graphics.Capture (OBS, Teams, Snipping Tool) is a manual check'
  exclusionOff = $off
  exclusionOn = $on
  stripPresentWhenOff = $presentOff
  stripAbsentWhenOn = $absentOn
  pass = ($presentOff -and $absentOn -and -not ($on.affinityCalls | Where-Object { $_.error }))
}
"exclusion off: strip black fraction layered=$($off.layeredState.stripBlackFraction) hittable=$($off.hittableState.stripBlackFraction)"
"exclusion on:  strip black fraction layered=$($on.layeredState.stripBlackFraction) hittable=$($on.hittableState.stripBlackFraction) · affinity errors: $(@($on.affinityCalls | Where-Object { $_.error }).Count)"
"pass (GDI path): $($summary.pass)"
Save-Result -Name 'w8-capture' -Data $summary
