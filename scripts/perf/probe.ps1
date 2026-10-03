<#
.SYNOPSIS
  Win32 probe for scripts/perf/index.mjs: one JSON line per command on stdin.
.DESCRIPTION
  Node keeps this process alive for a whole harness run so process trees, CPU times, working
  sets, the notch windows and the cursor can be sampled without paying a PowerShell start-up
  per sample. Commands (one per line) and their JSON answers:
    host                       logical processors, OS, physical primary screen size, memory
    tree <pid>                 the process and all its descendants with their kind (app,
                               browser, renderer, gpu-process, utility:<service>, crashpad)
                               and creation time as Unix milliseconds
    sample <pid,pid,...>       cpuMs (user+kernel), workingSetMb and privateWorkingSetMb per pid
    windows                    every top-level window of class MunaNotch with its physical rect
    cursor <x> <y>             SetCursorPos in physical pixels; without arguments GetCursorPos
    foreground                 GetForegroundWindow: hwnd, class name and owning pid
    quit
  Nothing here is part of the shipped app.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -Namespace MunaPerf -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
'@
# Per-monitor-v2 so every coordinate is a physical pixel.
[void][MunaPerf.Native]::SetProcessDpiAwarenessContext([IntPtr](-4))

function Get-ProcessKind([string]$Name, [string]$CommandLine) {
  if ($Name -notlike 'msedgewebview2*') { return ($Name -replace '\.exe$', '') }
  if ($CommandLine -match '--type=([a-z-]+)') {
    $type = $Matches[1]
    if ($type -eq 'crashpad-handler') { return 'crashpad' }
    if ($type -eq 'utility' -and $CommandLine -match '--utility-sub-type=([a-z_]+)\.') {
      return "utility:$($Matches[1])"
    }
    return $type
  }
  return 'browser'
}

function Get-Tree([int]$RootPid) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($RootPid)
  $list = New-Object System.Collections.Generic.List[object]
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    $row = $all | Where-Object { [int]$_.ProcessId -eq $current } | Select-Object -First 1
    $name = if ($null -ne $row) { $row.Name } else { 'unknown' }
    $kind = if ($null -ne $row) { Get-ProcessKind $row.Name ([string]$row.CommandLine) } else { 'unknown' }
    $startedAtMs = if ($null -ne $row -and $null -ne $row.CreationDate) {
      [DateTimeOffset]::new([DateTime]$row.CreationDate).ToUnixTimeMilliseconds()
    } else { $null }
    $list.Add([pscustomobject]@{ pid = $current; name = $name; kind = $kind; startedAtMs = $startedAtMs })
    foreach ($child in $all | Where-Object { [int]$_.ParentProcessId -eq $current -and [int]$_.ProcessId -ne $current }) {
      $queue.Enqueue([int]$child.ProcessId)
    }
  }
  $list
}

function Get-Sample([int[]]$Pids) {
  $private = @{}
  foreach ($row in Get-CimInstance Win32_PerfFormattedData_PerfProc_Process) {
    if ($Pids -contains [int]$row.IDProcess) { $private[[int]$row.IDProcess] = [double]$row.WorkingSetPrivate }
  }
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($id in $Pids) {
    $process = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($null -eq $process) { continue }
    $privateBytes = if ($private.ContainsKey($id)) { $private[$id] } else { $null }
    $list.Add([pscustomobject]@{
        pid = $id
        name = $process.ProcessName
        cpuMs = [math]::Round($process.TotalProcessorTime.TotalMilliseconds, 1)
        workingSetMb = [math]::Round($process.WorkingSet64 / 1MB, 2)
        privateWorkingSetMb = if ($null -ne $privateBytes) { [math]::Round($privateBytes / 1MB, 2) } else { $null }
      })
  }
  $list
}

function Get-NotchWindows {
  $found = New-Object System.Collections.Generic.List[object]
  $callback = [MunaPerf.Native+EnumWindowsProc]{
    param($hwnd, $lParam)
    $name = New-Object System.Text.StringBuilder 256
    [void][MunaPerf.Native]::GetClassNameW($hwnd, $name, 256)
    if ($name.ToString() -eq 'MunaNotch') {
      $r = New-Object MunaPerf.Native+RECT
      [void][MunaPerf.Native]::GetWindowRect($hwnd, [ref]$r)
      $found.Add([pscustomobject]@{
          hwnd = $hwnd.ToInt64(); left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom
          dpi = [int][MunaPerf.Native]::GetDpiForWindow($hwnd)
          visible = [bool][MunaPerf.Native]::IsWindowVisible($hwnd)
        })
    }
    $true
  }
  [void][MunaPerf.Native]::EnumWindows($callback, [IntPtr]::Zero)
  $found
}

function Get-HostInfo {
  $os = Get-CimInstance Win32_OperatingSystem
  [pscustomobject]@{
    os = "$($os.Caption.Trim()) $($os.Version)"
    logicalProcessors = [Environment]::ProcessorCount
    memoryGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
    screenWidth = [MunaPerf.Native]::GetSystemMetrics(0)
    screenHeight = [MunaPerf.Native]::GetSystemMetrics(1)
  }
}

function Get-Foreground {
  $hwnd = [MunaPerf.Native]::GetForegroundWindow()
  $name = New-Object System.Text.StringBuilder 256
  [void][MunaPerf.Native]::GetClassNameW($hwnd, $name, 256)
  $owner = [uint32]0
  [void][MunaPerf.Native]::GetWindowThreadProcessId($hwnd, [ref]$owner)
  [pscustomobject]@{ hwnd = $hwnd.ToInt64(); className = $name.ToString(); pid = [int]$owner }
}

function Write-Json($Value) {
  $json = if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
    ConvertTo-Json -InputObject @($Value) -Compress -Depth 6
  } else {
    ConvertTo-Json -InputObject $Value -Compress -Depth 6
  }
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim() -split '\s+', 2
  $command = $parts[0]
  $argument = if ($parts.Count -gt 1) { $parts[1] } else { '' }
  try {
    switch ($command) {
      'host' { Write-Json (Get-HostInfo) }
      'tree' { Write-Json @(Get-Tree ([int]$argument)) }
      'sample' { Write-Json @(Get-Sample @($argument -split ',' | Where-Object { $_ } | ForEach-Object { [int]$_ })) }
      'windows' { Write-Json @(Get-NotchWindows) }
      'foreground' { Write-Json (Get-Foreground) }
      'cursor' {
        if ($argument -eq '') {
          $p = New-Object MunaPerf.Native+POINT
          $ok = [MunaPerf.Native]::GetCursorPos([ref]$p)
          Write-Json ([pscustomobject]@{ ok = [bool]$ok; x = $p.X; y = $p.Y })
        } else {
          $xy = $argument -split '\s+'
          $ok = [MunaPerf.Native]::SetCursorPos([int]$xy[0], [int]$xy[1])
          Write-Json ([pscustomobject]@{ ok = [bool]$ok })
        }
      }
      'quit' { exit 0 }
      default { Write-Json ([pscustomobject]@{ error = "unknown command '$command'" }) }
    }
  } catch {
    Write-Json ([pscustomobject]@{ error = $_.Exception.Message })
  }
}
