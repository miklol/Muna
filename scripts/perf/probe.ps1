<#
.SYNOPSIS
  Win32 probe for scripts/perf/index.mjs: one JSON line per command on stdin.
.DESCRIPTION
  Node keeps this process alive for a whole harness run so process trees, CPU times, working
  sets, the notch windows and the cursor can be sampled without paying a PowerShell start-up
  per sample. Commands (one per line) and their JSON answers:
    host                       logical processors, OS, physical primary screen size, memory,
                               session (id, interactive, mouse present, cursor clip)
    tree <pid>                 the process and all its descendants with their kind (app,
                               browser, renderer, gpu-process, utility:<service>, crashpad)
                               and creation time as Unix milliseconds
    sample <pid,pid,...>       cpuMs (user+kernel), workingSetMb and privateWorkingSetMb per pid
    windows                    every top-level window of class MunaNotch with its physical rect,
                               owning pid and extended style (clickThrough = WS_EX_TRANSPARENT)
    cursor <x> <y>             SetCursorPos in physical pixels; without arguments GetCursorPos
    input <x> <y>              SendInput absolute mouse move to physical pixels (goes through
                               the input stack, unlike SetCursorPos)
    point <x> <y>              WindowFromPoint: the window that would receive the pointer there
    foreground                 GetForegroundWindow: hwnd, class, owning process, rect, styles
    quit
  Nothing here is part of the shipped app.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -Namespace MunaPerf -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
[StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern bool GetClipCursor(out RECT r);
[DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
[DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
[DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
'@
# Per-monitor-v2 so every coordinate is a physical pixel.
[void][MunaPerf.Native]::SetProcessDpiAwarenessContext([IntPtr](-4))

$GWL_STYLE = -16
$GWL_EXSTYLE = -20
$WS_CAPTION = 0x00C00000
$WS_POPUP = 0x80000000
$WS_EX_TRANSPARENT = 0x00000020
$WS_EX_LAYERED = 0x00080000
$WS_EX_NOACTIVATE = 0x08000000
$WS_EX_TOPMOST = 0x00000008

function Get-ClassName([IntPtr]$Hwnd) {
  $name = New-Object System.Text.StringBuilder 256
  [void][MunaPerf.Native]::GetClassNameW($Hwnd, $name, 256)
  $name.ToString()
}

function Get-OwnerPid([IntPtr]$Hwnd) {
  $owner = [uint32]0
  [void][MunaPerf.Native]::GetWindowThreadProcessId($Hwnd, [ref]$owner)
  [int]$owner
}

function Get-ProcessNameOf([int]$ProcessId) {
  if ($ProcessId -le 0) { return '' }
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) { '' } else { $process.ProcessName }
}

function Get-Rect([IntPtr]$Hwnd) {
  $r = New-Object MunaPerf.Native+RECT
  [void][MunaPerf.Native]::GetWindowRect($Hwnd, [ref]$r)
  [pscustomobject]@{ left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom }
}

# Window styles as hex plus the bits the harness reasons about.
function Get-Styles([IntPtr]$Hwnd) {
  $style = [MunaPerf.Native]::GetWindowLongPtr($Hwnd, $GWL_STYLE).ToInt64() -band 0xFFFFFFFF
  $exStyle = [MunaPerf.Native]::GetWindowLongPtr($Hwnd, $GWL_EXSTYLE).ToInt64() -band 0xFFFFFFFF
  [pscustomobject]@{
    style = ('0x{0:X8}' -f $style)
    exStyle = ('0x{0:X8}' -f $exStyle)
    caption = (($style -band $WS_CAPTION) -eq $WS_CAPTION)
    popup = (($style -band $WS_POPUP) -ne 0)
    clickThrough = (($exStyle -band $WS_EX_TRANSPARENT) -ne 0)
    layered = (($exStyle -band $WS_EX_LAYERED) -ne 0)
    noActivate = (($exStyle -band $WS_EX_NOACTIVATE) -ne 0)
    topmost = (($exStyle -band $WS_EX_TOPMOST) -ne 0)
  }
}

# A top-level window described for the report: class, owner, rect and styles (never the title,
# which may be a document or a message the user is reading).
function Describe-Window([IntPtr]$Hwnd) {
  if ($Hwnd -eq [IntPtr]::Zero) { return $null }
  $owner = Get-OwnerPid $Hwnd
  $styles = Get-Styles $Hwnd
  [pscustomobject]@{
    hwnd = $Hwnd.ToInt64()
    className = Get-ClassName $Hwnd
    pid = $owner
    processName = Get-ProcessNameOf $owner
    rect = Get-Rect $Hwnd
    visible = [bool][MunaPerf.Native]::IsWindowVisible($Hwnd)
    style = $styles.style
    exStyle = $styles.exStyle
    caption = $styles.caption
    popup = $styles.popup
    clickThrough = $styles.clickThrough
    topmost = $styles.topmost
  }
}

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
    if ((Get-ClassName $hwnd) -eq 'MunaNotch') {
      $r = New-Object MunaPerf.Native+RECT
      [void][MunaPerf.Native]::GetWindowRect($hwnd, [ref]$r)
      $styles = Get-Styles $hwnd
      $found.Add([pscustomobject]@{
          hwnd = $hwnd.ToInt64(); left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom
          dpi = [int][MunaPerf.Native]::GetDpiForWindow($hwnd)
          visible = [bool][MunaPerf.Native]::IsWindowVisible($hwnd)
          pid = Get-OwnerPid $hwnd
          exStyle = $styles.exStyle
          clickThrough = $styles.clickThrough
          layered = $styles.layered
          noActivate = $styles.noActivate
          topmost = $styles.topmost
        })
    }
    $true
  }
  [void][MunaPerf.Native]::EnumWindows($callback, [IntPtr]::Zero)
  $found
}

function Get-HostInfo {
  $os = Get-CimInstance Win32_OperatingSystem
  $clip = New-Object MunaPerf.Native+RECT
  $clipped = [MunaPerf.Native]::GetClipCursor([ref]$clip)
  [pscustomobject]@{
    os = "$($os.Caption.Trim()) $($os.Version)"
    logicalProcessors = [Environment]::ProcessorCount
    memoryGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
    screenWidth = [MunaPerf.Native]::GetSystemMetrics(0)
    screenHeight = [MunaPerf.Native]::GetSystemMetrics(1)
    # SM_MOUSEPRESENT: a session without a pointing device still has a cursor, but some
    # input paths behave differently (docs/09-testing-qa.md, performance harness).
    mousePresent = ([MunaPerf.Native]::GetSystemMetrics(19) -ne 0)
    sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    interactive = [Environment]::UserInteractive
    clipCursor = if ($clipped) { [pscustomobject]@{ left = $clip.Left; top = $clip.Top; right = $clip.Right; bottom = $clip.Bottom } } else { $null }
  }
}

function Get-Foreground {
  $hwnd = [MunaPerf.Native]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { return [pscustomobject]@{ hwnd = 0; className = ''; pid = 0 } }
  Describe-Window $hwnd
}

function Get-WindowAtPoint([int]$X, [int]$Y) {
  $p = New-Object MunaPerf.Native+POINT
  $p.X = $X
  $p.Y = $Y
  $hwnd = [MunaPerf.Native]::WindowFromPoint($p)
  if ($hwnd -eq [IntPtr]::Zero) { return [pscustomobject]@{ hwnd = 0; className = ''; pid = 0 } }
  # GA_ROOT (2): the top-level window the hit child belongs to.
  $root = [MunaPerf.Native]::GetAncestor($hwnd, 2)
  $described = Describe-Window $hwnd
  $described | Add-Member -NotePropertyName rootHwnd -NotePropertyValue $root.ToInt64()
  $described | Add-Member -NotePropertyName rootClassName -NotePropertyValue (Get-ClassName $root)
  $described
}

# An absolute mouse move through SendInput (MOUSEEVENTF_MOVE | ABSOLUTE | VIRTUALDESK), in
# physical pixels of the virtual desktop; unlike SetCursorPos it enters the input stack.
function Send-MouseMove([int]$X, [int]$Y) {
  $left = [MunaPerf.Native]::GetSystemMetrics(76)   # SM_XVIRTUALSCREEN
  $top = [MunaPerf.Native]::GetSystemMetrics(77)    # SM_YVIRTUALSCREEN
  $width = [MunaPerf.Native]::GetSystemMetrics(78)  # SM_CXVIRTUALSCREEN
  $height = [MunaPerf.Native]::GetSystemMetrics(79) # SM_CYVIRTUALSCREEN
  if ($width -le 0 -or $height -le 0) { return [pscustomobject]@{ ok = $false; error = 'no virtual screen' } }
  $move = New-Object MunaPerf.Native+MOUSEINPUT
  $move.dx = [int][math]::Round((($X - $left) * 65535.0) / $width)
  $move.dy = [int][math]::Round((($Y - $top) * 65535.0) / $height)
  $move.dwFlags = 0x0001 -bor 0x8000 -bor 0x4000 # MOVE | ABSOLUTE | VIRTUALDESK
  $event = New-Object MunaPerf.Native+INPUT
  $event.type = 0 # INPUT_MOUSE
  $event.mi = $move
  $sent = [MunaPerf.Native]::SendInput(1, [MunaPerf.Native+INPUT[]]@($event), [System.Runtime.InteropServices.Marshal]::SizeOf([type][MunaPerf.Native+INPUT]))
  # The raw input thread applies the move asynchronously; give it a moment before reading back.
  Start-Sleep -Milliseconds 5
  $p = New-Object MunaPerf.Native+POINT
  [void][MunaPerf.Native]::GetCursorPos([ref]$p)
  [pscustomobject]@{ ok = ($sent -eq 1); x = $p.X; y = $p.Y }
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
      'point' {
        $xy = $argument -split '\s+'
        Write-Json (Get-WindowAtPoint ([int]$xy[0]) ([int]$xy[1]))
      }
      'input' {
        $xy = $argument -split '\s+'
        Write-Json (Send-MouseMove ([int]$xy[0]) ([int]$xy[1]))
      }
      'cursor' {
        if ($argument -eq '') {
          $p = New-Object MunaPerf.Native+POINT
          $ok = [MunaPerf.Native]::GetCursorPos([ref]$p)
          Write-Json ([pscustomobject]@{ ok = [bool]$ok; x = $p.X; y = $p.Y })
        } else {
          $xy = $argument -split '\s+'
          $ok = [MunaPerf.Native]::SetCursorPos([int]$xy[0], [int]$xy[1])
          $p = New-Object MunaPerf.Native+POINT
          [void][MunaPerf.Native]::GetCursorPos([ref]$p)
          Write-Json ([pscustomobject]@{ ok = [bool]$ok; x = $p.X; y = $p.Y })
        }
      }
      'quit' { exit 0 }
      default { Write-Json ([pscustomobject]@{ error = "unknown command '$command'" }) }
    }
  } catch {
    Write-Json ([pscustomobject]@{ error = $_.Exception.Message })
  }
}
