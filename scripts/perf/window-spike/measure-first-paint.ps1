<#
.SYNOPSIS
  W3 · first strip paint after process start (median of N cold starts).
.DESCRIPTION
  Starts the spike N times. Two numbers per start: the in-process `ready.t_ms` (Instant taken
  at the top of `run()` → the UI's second requestAnimationFrame after first paint) and the
  wall-clock delta from `Process.StartTime` to the moment the `ready` line is visible in the
  JSONL (includes image load, polled every 5 ms, so it over-reads slightly).
#>
param([int]$Runs = 10)
. (Join-Path $PSScriptRoot 'common.ps1')

$results = @()
for ($i = 1; $i -le $Runs; $i++) {
  $process = Start-Spike
  $started = $process.StartTime
  $deadline = [DateTime]::Now.AddSeconds(20)
  $ready = $null
  while ([DateTime]::Now -lt $deadline) {
    $ready = @(Read-SpikeLog | Where-Object { $_.event -eq 'ready' -and $_.label -eq 'notch' })
    if ($ready.Count -gt 0) { break }
    Start-Sleep -Milliseconds 5
  }
  $observed = [DateTime]::Now
  if ($ready.Count -eq 0) { Stop-Spike; throw "run ${i}: no ready event within 20 s" }
  $wall = ($observed - $started).TotalMilliseconds
  $results += [pscustomobject]@{ run = $i; inProcessMs = [math]::Round($ready[0].t_ms, 1); wallClockMs = [math]::Round($wall, 1) }
  Write-Host ("run {0}: in-process {1} ms, wall-clock {2} ms" -f $i, $results[-1].inProcessMs, $results[-1].wallClockMs)
  Stop-Spike
  Start-Sleep -Milliseconds 500
}

$summary = [pscustomobject]@{
  criterion = 'W3'
  budgetMs = 800
  runs = $results
  medianInProcessMs = Get-Median ($results | ForEach-Object { [double]$_.inProcessMs })
  medianWallClockMs = Get-Median ($results | ForEach-Object { [double]$_.wallClockMs })
  maxWallClockMs = ($results | Measure-Object -Property wallClockMs -Maximum).Maximum
}
$summary | Format-List criterion, budgetMs, medianInProcessMs, medianWallClockMs, maxWallClockMs
Save-Result -Name 'w3-first-paint' -Data $summary
