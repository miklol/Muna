<#
.SYNOPSIS
  W5 diagnostic · which driver the WebView2 GPU process loads, and how much private memory it
  holds, across several fresh starts.
.DESCRIPTION
  The GPU process is the largest member of the WebView2 tree and is bimodal on hybrid
  laptops. This probe starts the spike -Runs times, waits -SettleSeconds, then records the
  GPU process's private working set together with the graphics-driver DLLs it has loaded
  (Intel `ig*`, NVIDIA `nv*`, AMD `amd*`/`ati*`) so the two modes can be told apart.
#>
param(
  [int]$Runs = 4,
  [int]$SettleSeconds = 30,
  [hashtable]$SpikeEnv = @{},
  [string]$ResultName = 'w5-gpu-process-probe'
)
. (Join-Path $PSScriptRoot 'common.ps1')

$results = @()
for ($run = 1; $run -le $Runs; $run++) {
  $process = Start-Spike -Env $SpikeEnv
  [void](Wait-SpikeEvent -Event ready -Where { $_.label -eq 'notch' } -TimeoutMs 20000)
  [void][MunaSpike.Native]::SetCursorPos(200, 1400)
  Start-Sleep -Seconds $SettleSeconds
  $tree = Get-DescendantProcessIds -RootPid $process.Id
  $gpu = Get-CimInstance Win32_Process | Where-Object { $tree -contains [int]$_.ProcessId -and $_.CommandLine -match '--type=gpu-process' } | Select-Object -First 1
  if (-not $gpu) { Write-Warning "run ${run}: no gpu-process found"; Stop-Spike; continue }
  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { [int]$_.IDProcess -eq [int]$gpu.ProcessId }
  $modules = @()
  try {
    $modules = @((Get-Process -Id $gpu.ProcessId).Modules | Where-Object { $_.ModuleName -match '^(ig|nv|amd|ati|d3d|dxgi|dxil|vulkan|libEGL|libGLESv2)' } |
      ForEach-Object { [pscustomobject]@{ name = $_.ModuleName; sizeMb = [math]::Round($_.ModuleMemorySize / 1MB, 1) } })
  } catch { Write-Warning "run ${run}: module list unavailable ($($_.Exception.Message))" }
  $switches = @([regex]::Matches($gpu.CommandLine, '--(gpu-[a-z-]+|use-gl|use-angle|enable-features|disable-features)=[^ ]+') | ForEach-Object { $_.Value })
  $entry = [pscustomobject]@{
    run = $run
    gpuPid = [int]$gpu.ProcessId
    privateWorkingSetMb = [math]::Round($perf.WorkingSetPrivate / 1MB, 1)
    workingSetMb = [math]::Round($perf.WorkingSet / 1MB, 1)
    driverModules = $modules
    gpuSwitches = $switches
  }
  $results += $entry
  "run ${run}: gpu-process pid $($entry.gpuPid) private $($entry.privateWorkingSetMb) MB; modules: $(($modules | ForEach-Object { "$($_.name) ($($_.sizeMb) MB)" }) -join ', ')"
  Stop-Spike
  Start-Sleep -Seconds 3
}

Save-Result -Name $ResultName -Data ([pscustomobject]@{ criterion = 'W5 diagnostic'; settleSeconds = $SettleSeconds; spikeEnv = $SpikeEnv; runs = $results })
