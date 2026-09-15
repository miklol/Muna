<#
.SYNOPSIS
  W4 · idle CPU and W5 · resident set, strip visible, cursor elsewhere.
.DESCRIPTION
  Starts the spike, parks the cursor on the secondary monitor edge (or the bottom of the
  primary), waits for the process tree to settle, then samples PDH counters for muna.exe and
  every descendant msedgewebview2.exe:
    · `% Processor Time` summed over the tree, averaged over -CpuSeconds, reported both as
      raw (one core = 100 %) and normalised by logical processor count (Task Manager style —
      the PRD budget is written in that convention).
    · `Working Set - Private` summed over the tree after -RssAfterSeconds of idle, plus a
      time series sampled every -MemorySampleSeconds so the noisy GPU process can be compared
      by median across A/B runs rather than by one sample.
#>
param(
  [int]$CpuSeconds = 60,
  [int]$RssAfterSeconds = 300,
  [int]$WarmupSeconds = 15,
  [int]$MemorySampleSeconds = 10,
  # Extra environment for the spike process (A/B of WebView2 knobs), e.g.
  # @{ WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--process-per-site'; MUNA_SPIKE_MEMORY_LOW = 20 }.
  [hashtable]$SpikeEnv = @{},
  # Result file name; keep the default for the record, use a variant name for A/B runs.
  [string]$ResultName = 'w4-w5-idle'
)
. (Join-Path $PSScriptRoot 'common.ps1')

$process = Start-Spike -Env $SpikeEnv
[void](Wait-SpikeEvent -Event ready -Where { $_.label -eq 'notch' } -TimeoutMs 20000)
# Cursor far from any notch window so the poll stays at its idle rate.
[void][MunaSpike.Native]::SetCursorPos(200, 1400)
Write-Host "warming up ${WarmupSeconds} s…"
Start-Sleep -Seconds $WarmupSeconds

$tree = Get-DescendantProcessIds -RootPid $process.Id
$names = $tree | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName } | Sort-Object -Unique
Write-Host "process tree: $($tree.Count) processes ($($names -join ', '))"

function Get-TreeInstances {
  # Map PDH instance names (msedgewebview2#3 …) to PIDs so we sum exactly our tree.
  $ids = Get-Counter '\Process(*)\ID Process' -ErrorAction SilentlyContinue
  $ids.CounterSamples | Where-Object { $tree -contains [int]$_.CookedValue } | ForEach-Object { $_.InstanceName }
}

function Get-ProcessTypes {
  # browser / gpu-process / renderer / utility/<Service> / muna, from the Chromium command lines.
  $types = @{}
  foreach ($proc in Get-CimInstance Win32_Process | Where-Object { $tree -contains [int]$_.ProcessId }) {
    $type = if ($proc.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } elseif ($proc.Name -eq 'muna.exe') { 'muna' } else { 'browser' }
    if ($proc.CommandLine -match '--utility-sub-type=[a-z]+\.mojom\.([A-Za-z]+)') { $type += "/$($Matches[1])" }
    $types[[int]$proc.ProcessId] = $type
  }
  $types
}

function Sample-TreeMemory([int]$AtSeconds) {
  # PID-keyed perf data (same counters as PDH) so no instance-name mapping can drop a process.
  $script:tree = Get-DescendantProcessIds -RootPid $process.Id
  $types = Get-ProcessTypes
  $perf = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $tree -contains [int]$_.IDProcess })
  $perProcess = @($perf | ForEach-Object { [pscustomobject]@{ pid = [int]$_.IDProcess; name = $_.Name; type = $types[[int]$_.IDProcess]; privateWorkingSetMb = [math]::Round($_.WorkingSetPrivate / 1MB, 1); workingSetMb = [math]::Round($_.WorkingSet / 1MB, 1) } })
  $gpu = 0.0
  foreach ($p in $perProcess) { if ($p.type -eq 'gpu-process') { $gpu += $p.privateWorkingSetMb } }
  [pscustomobject]@{
    atSeconds = $AtSeconds
    processes = $perf.Count
    privateWorkingSetMb = [math]::Round((($perf | Measure-Object -Property WorkingSetPrivate -Sum).Sum) / 1MB, 1)
    totalWorkingSetMb = [math]::Round((($perf | Measure-Object -Property WorkingSet -Sum).Sum) / 1MB, 1)
    gpuProcessPrivateMb = [double]$gpu
    perProcess = $perProcess
  }
}

$logicalProcessors = [Environment]::ProcessorCount
$memorySeries = @()
$memorySeries += Sample-TreeMemory -AtSeconds $WarmupSeconds
Write-Host ("memory at {0,3} s: private {1,6:N1} MB (gpu {2,5:N1})" -f $WarmupSeconds, $memorySeries[-1].privateWorkingSetMb, $memorySeries[-1].gpuProcessPrivateMb)
$cpuSamples = @()
$instances = @(Get-TreeInstances)
$paths = $instances | ForEach-Object { "\Process($_)\% Processor Time" }
Write-Host "sampling CPU for ${CpuSeconds} s over $($instances.Count) instances…"
$counter = Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples $CpuSeconds -ErrorAction SilentlyContinue
foreach ($set in $counter) {
  $sum = ($set.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum
  $cpuSamples += [double]$sum
}
$rawAvg = ($cpuSamples | Measure-Object -Average).Average
$normalisedAvg = $rawAvg / $logicalProcessors

$elapsed = $WarmupSeconds + $CpuSeconds
$memorySeries += Sample-TreeMemory -AtSeconds $elapsed
Write-Host ("memory at {0,3} s: private {1,6:N1} MB (gpu {2,5:N1})" -f $elapsed, $memorySeries[-1].privateWorkingSetMb, $memorySeries[-1].gpuProcessPrivateMb)
$remaining = $RssAfterSeconds - $elapsed
if ($remaining -gt 0) { Write-Host "idling ${remaining} s more, sampling memory every ${MemorySampleSeconds} s…" }
while ($elapsed -lt $RssAfterSeconds) {
  $step = [math]::Min($MemorySampleSeconds, $RssAfterSeconds - $elapsed)
  Start-Sleep -Seconds $step
  $elapsed += $step
  $memorySeries += Sample-TreeMemory -AtSeconds $elapsed
  Write-Host ("memory at {0,3} s: private {1,6:N1} MB (gpu {2,5:N1})" -f $elapsed, $memorySeries[-1].privateWorkingSetMb, $memorySeries[-1].gpuProcessPrivateMb)
}
$final = $memorySeries[-1]
$perProcess = $final.perProcess
if ($final.processes -ne $tree.Count) { Write-Warning "sampled $($final.processes) of $($tree.Count) tree processes" }
$sortedPrivate = @($memorySeries | ForEach-Object { $_.privateWorkingSetMb } | Sort-Object)
$medianPrivate = $sortedPrivate[[math]::Floor(($sortedPrivate.Count - 1) / 2)]
$sortedGpu = @($memorySeries | ForEach-Object { $_.gpuProcessPrivateMb } | Sort-Object)
$medianGpu = $sortedGpu[[math]::Floor(($sortedGpu.Count - 1) / 2)]

$log = Read-SpikeLog
$summary = [pscustomobject]@{
  criterion = 'W4+W5'
  budgets = @{ idleCpuPercent = 0.3; rssMb = 120 }
  logicalProcessors = $logicalProcessors
  processTree = $tree.Count
  cpu = @{
    seconds = $cpuSamples.Count
    rawAveragePercent = [math]::Round($rawAvg, 3)
    normalisedAveragePercent = [math]::Round($normalisedAvg, 4)
    rawMaxPercent = [math]::Round(($cpuSamples | Measure-Object -Maximum).Maximum, 3)
  }
  memory = @{
    afterSeconds = $RssAfterSeconds
    processesSampled = $final.processes
    privateWorkingSetMb = $final.privateWorkingSetMb
    totalWorkingSetMb = $final.totalWorkingSetMb
    perProcess = $perProcess
    series = @{
      sampleSeconds = $MemorySampleSeconds
      samples = $memorySeries.Count
      privateWorkingSetMb = @{ min = $sortedPrivate[0]; median = $medianPrivate; max = $sortedPrivate[-1] }
      gpuProcessPrivateMb = @{ min = $sortedGpu[0]; median = $medianGpu; max = $sortedGpu[-1] }
      points = @($memorySeries | ForEach-Object { [pscustomobject]@{ atSeconds = $_.atSeconds; processes = $_.processes; privateWorkingSetMb = $_.privateWorkingSetMb; gpuProcessPrivateMb = $_.gpuProcessPrivateMb } })
    }
  }
  spikeEnv = $SpikeEnv
  memoryTargetEvents = @($log | Where-Object { $_.event -eq 'memory_target' } | ForEach-Object { "$($_.label): $($_.target) $(if ($_.error) { $_.error } else { 'ok' })" })
  ignoreCursorEventsDuringRun = @($log | Where-Object { $_.event -eq 'ignore_cursor' }).Count
  spikeEventsDuringRun = $log.Count
}
$summary.cpu | Format-Table | Out-String | Write-Host
"memory after $RssAfterSeconds s: private working set $($summary.memory.privateWorkingSetMb) MB, working set $($summary.memory.totalWorkingSetMb) MB over $($final.processes) processes"
"  series ($($memorySeries.Count) samples): private min $($sortedPrivate[0]) / median $medianPrivate / max $($sortedPrivate[-1]) MB; gpu-process min $($sortedGpu[0]) / median $medianGpu / max $($sortedGpu[-1]) MB"
$perProcess | Sort-Object privateWorkingSetMb -Descending | ForEach-Object { "  {0,-28} private {1,6:N1} MB" -f $_.type, $_.privateWorkingSetMb }
Save-Result -Name $ResultName -Data $summary
Stop-Spike
