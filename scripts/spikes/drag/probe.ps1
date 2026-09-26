<#
.SYNOPSIS
  Win32 side of docs/spikes/m4-drag.md (S2): drop targets and a scripted drag gesture.
.DESCRIPTION
  Node keeps this process alive for a run and sends one command per line on stdin; every
  command answers with one JSON line. Coordinates are physical pixels (per-monitor-v2).
    explorer <folder> <x> <y> <w> <h>   open an Explorer window on <folder>, place it, answer
                                         { hwnd, left, top, right, bottom }
    edge <page> <x> <y> <w> <h>          start Microsoft Edge (--app, fresh profile) on the page,
                                         wait for a window titled "S2:ready", place it, answer
                                         { pid, hwnd, left, top, right, bottom } or { skip }
    title <hwnd>                         { title } of a top-level window (GetWindowTextW)
    hover <x> <y> <ms>                   move to (x,y) and jitter one pixel every 50 ms for
                                         <ms>, like a resting hand: the shell's cursor poll
                                         re-enables pointer events and the webview sees moves,
                                         so a peeking or collapsed strip reveals before a press.
                                         Answers { done, under: { hwnd, class, pid, process } },
                                         the top-level window that owns the pointer there
    under <x> <y>                        move the cursor to (x,y), wait a poll, answer
                                         { hwnd, class, pid, process } of the top-level window
                                         that owns the pointer there
    drag <x0> <y0> <x1> <y1> [holdMs]    move to (x0,y0), dwell 250 ms, left down, 12 hops of
                                         2 px down over ~100 ms, 24 hops to (x1,y1) over
                                         ~400 ms, dwell holdMs (300), left up. Phases as JSON
                                         lines: down, threshold (after the third hop), arrived,
                                         up, then the final { done } answer
    click <x> <y>                        move to (x,y), dwell 250 ms, left down, 80 ms, left up:
                                         a press that never becomes a drag (control for the
                                         focus criterion)
    close <hwnd>                         WM_CLOSE to the window
    kill <pid>                           stop a process (Edge)
    quit
  Nothing here is part of the shipped app.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -Namespace MunaDragSpike -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
[StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
[DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
'@
# Per-monitor-v2 so every coordinate is a physical pixel like the perf probe's.
[void][MunaDragSpike.Native]::SetProcessDpiAwarenessContext([IntPtr](-4))

$INPUT_MOUSE = [uint32]0
$MOUSEEVENTF_LEFTDOWN = [uint32]0x0002
$MOUSEEVENTF_LEFTUP = [uint32]0x0004
$WM_CLOSE = [uint32]0x0010
$SWP_NOZORDER = [uint32]0x0004
$SWP_NOMOVE = [uint32]0x0002
$SWP_NOSIZE = [uint32]0x0001
$SWP_SHOWWINDOW = [uint32]0x0040
$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$script:found = [IntPtr]::Zero

function Write-Json($Value) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Value -Compress -Depth 6))
  [Console]::Out.Flush()
}

function Write-Phase([string] $Phase, [hashtable] $Fields = @{}) {
  $Fields['phase'] = $Phase
  $Fields['atMs'] = [math]::Round($clock.Elapsed.TotalMilliseconds, 1)
  Write-Json ([pscustomobject]$Fields)
}

function Get-Rect([IntPtr] $Hwnd) {
  $r = New-Object MunaDragSpike.Native+RECT
  [void][MunaDragSpike.Native]::GetWindowRect($Hwnd, [ref]$r)
  @{ left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom }
}

function Get-Title([IntPtr] $Hwnd) {
  $s = New-Object System.Text.StringBuilder 512
  [void][MunaDragSpike.Native]::GetWindowTextW($Hwnd, $s, 512)
  $s.ToString()
}

function Find-Window([scriptblock] $Match) {
  $script:found = [IntPtr]::Zero
  $callback = [MunaDragSpike.Native+EnumWindowsProc]{
    param($hwnd, $lParam)
    if (-not [MunaDragSpike.Native]::IsWindowVisible($hwnd)) { return $true }
    $name = New-Object System.Text.StringBuilder 256
    [void][MunaDragSpike.Native]::GetClassNameW($hwnd, $name, 256)
    $owner = [uint32]0
    [void][MunaDragSpike.Native]::GetWindowThreadProcessId($hwnd, [ref]$owner)
    if (& $Match $hwnd $name.ToString() (Get-Title $hwnd) ([int]$owner)) {
      $script:found = $hwnd
      return $false
    }
    $true
  }
  [void][MunaDragSpike.Native]::EnumWindows($callback, [IntPtr]::Zero)
  $script:found
}

function Set-Placement([IntPtr] $Hwnd, [int] $X, [int] $Y, [int] $W, [int] $H) {
  [void][MunaDragSpike.Native]::SetWindowPos($Hwnd, [IntPtr]::Zero, $X, $Y, $W, $H, $SWP_NOZORDER -bor $SWP_SHOWWINDOW)
  # A window opened from a background process comes up *behind* the foreground app; a trip
  # through the topmost band raises it without needing foreground rights.
  [void][MunaDragSpike.Native]::SetWindowPos($Hwnd, $HWND_TOPMOST, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE)
  [void][MunaDragSpike.Native]::SetWindowPos($Hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE)
  [void][MunaDragSpike.Native]::SetForegroundWindow($Hwnd)
  Start-Sleep -Milliseconds 300
}

function Open-Explorer([string] $Folder, [int] $X, [int] $Y, [int] $W, [int] $H) {
  $full = (Resolve-Path -LiteralPath $Folder).Path
  Start-Process explorer.exe -ArgumentList "`"$full`""
  $shell = New-Object -ComObject Shell.Application
  $hwnd = [IntPtr]::Zero
  for ($i = 0; $i -lt 60 -and $hwnd -eq [IntPtr]::Zero; $i += 1) {
    Start-Sleep -Milliseconds 250
    foreach ($window in @($shell.Windows())) {
      try {
        $path = [System.Uri]::UnescapeDataString(($window.LocationURL -replace '^file:///', '')) -replace '/', '\'
        if ($path.TrimEnd('\') -ieq $full.TrimEnd('\')) { $hwnd = [IntPtr]([int64]$window.HWND); break }
      } catch { }
    }
  }
  if ($hwnd -eq [IntPtr]::Zero) { throw "no Explorer window opened on $full" }
  Set-Placement $hwnd $X $Y $W $H
  [void][MunaDragSpike.Native]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 500
  $rect = Get-Rect $hwnd
  $rect['hwnd'] = $hwnd.ToInt64()
  [pscustomobject]$rect
}

function Close-OtherWindows([int] $Owner, [IntPtr] $Keep) {
  # Edge shows its first-run / sign-in dialog as a second visible top-level window in front
  # of the --app window even with --no-first-run; a drop would land on the dialog.
  for ($round = 0; $round -lt 6; $round += 1) {
    $others = New-Object System.Collections.Generic.List[IntPtr]
    $callback = [MunaDragSpike.Native+EnumWindowsProc]{
      param($hwnd, $lParam)
      if ($hwnd -ne $Keep -and [MunaDragSpike.Native]::IsWindowVisible($hwnd)) {
        $pidOf = [uint32]0
        [void][MunaDragSpike.Native]::GetWindowThreadProcessId($hwnd, [ref]$pidOf)
        if ([int]$pidOf -eq $Owner) { $others.Add($hwnd) }
      }
      $true
    }
    [void][MunaDragSpike.Native]::EnumWindows($callback, [IntPtr]::Zero)
    if ($others.Count -eq 0) { return }
    foreach ($other in $others) {
      [void][MunaDragSpike.Native]::PostMessageW($other, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 400
  }
}

function Find-Edge {
  foreach ($candidate in @(
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
      "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe")) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  $null
}

function Open-Edge([string] $Page, [int] $X, [int] $Y, [int] $W, [int] $H) {
  $edge = Find-Edge
  if ($null -eq $edge) { return [pscustomobject]@{ skip = 'Microsoft Edge is not installed' } }
  $profile = Join-Path ([System.IO.Path]::GetTempPath()) ("muna-drag-spike-edge-" + [guid]::NewGuid().ToString('n'))
  $url = ([System.Uri](Resolve-Path -LiteralPath $Page).Path).AbsoluteUri
  $process = Start-Process -FilePath $edge -PassThru -ArgumentList @(
    "--app=$url", "--user-data-dir=$profile", '--no-first-run', '--no-default-browser-check',
    "--window-position=$X,$Y", "--window-size=$W,$H")
  $hwnd = [IntPtr]::Zero
  for ($i = 0; $i -lt 80 -and $hwnd -eq [IntPtr]::Zero; $i += 1) {
    Start-Sleep -Milliseconds 250
    $hwnd = Find-Window { param($h, $class, $title, $owner) $title -like 'S2:*' }
  }
  if ($hwnd -eq [IntPtr]::Zero) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'Edge opened no window titled S2:*'
  }
  Close-OtherWindows $process.Id $hwnd
  Set-Placement $hwnd $X $Y $W $H
  Start-Sleep -Milliseconds 500
  Close-OtherWindows $process.Id $hwnd
  $rect = Get-Rect $hwnd
  $rect['hwnd'] = $hwnd.ToInt64()
  $rect['pid'] = $process.Id
  $rect['profile'] = $profile
  [pscustomobject]$rect
}

function Send-Mouse([uint32] $Flags) {
  # Build the nested struct first: PowerShell hands out a *copy* of a value-type member, so
  # `$event.mi.dwFlags = …` would set the flag on a temporary and inject a no-op event.
  $mouse = New-Object MunaDragSpike.Native+MOUSEINPUT
  $mouse.dwFlags = $Flags
  $event = New-Object MunaDragSpike.Native+INPUT
  $event.type = $INPUT_MOUSE
  $event.mi = $mouse
  $size = [System.Runtime.InteropServices.Marshal]::SizeOf([type][MunaDragSpike.Native+INPUT])
  if ([MunaDragSpike.Native]::SendInput(1, @($event), $size) -ne 1) { throw 'SendInput failed' }
}

function Get-WindowUnder([int] $X, [int] $Y) {
  # The top-level window that would receive the pointer at (x, y): another app's window here
  # (a second notch utility, an overlay) means the strip cannot be grabbed.
  $p = New-Object MunaDragSpike.Native+POINT
  $p.X = $X
  $p.Y = $Y
  $hwnd = [MunaDragSpike.Native]::WindowFromPoint($p)
  $root = [MunaDragSpike.Native]::GetAncestor($hwnd, 2)
  if ($root -eq [IntPtr]::Zero) { $root = $hwnd }
  $class = New-Object System.Text.StringBuilder 256
  [void][MunaDragSpike.Native]::GetClassNameW($root, $class, 256)
  $owner = [uint32]0
  [void][MunaDragSpike.Native]::GetWindowThreadProcessId($root, [ref]$owner)
  $name = try { (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { $null }
  @{ hwnd = $root.ToInt64(); class = $class.ToString(); pid = [int]$owner; process = $name }
}

function Invoke-Hover([int] $X, [int] $Y, [int] $Ms) {
  [void][MunaDragSpike.Native]::SetCursorPos($X, $Y)
  $until = $clock.ElapsedMilliseconds + $Ms
  $j = 0
  while ($clock.ElapsedMilliseconds -lt $until) {
    Start-Sleep -Milliseconds 50
    $j += 1
    [void][MunaDragSpike.Native]::SetCursorPos($X + ($j % 2), $Y + (($j -shr 1) % 2))
  }
  [void][MunaDragSpike.Native]::SetCursorPos($X, $Y)
  [pscustomobject]@{ done = $true; under = (Get-WindowUnder $X $Y) }
}

function Invoke-Drag([int] $X0, [int] $Y0, [int] $X1, [int] $Y1, [int] $HoldMs) {
  [void][MunaDragSpike.Native]::SetCursorPos($X0, $Y0)
  Start-Sleep -Milliseconds 250
  Send-Mouse $MOUSEEVENTF_LEFTDOWN
  Start-Sleep -Milliseconds 30
  # The system's view of the button: `false` here means the injection was dropped.
  $held = ([MunaDragSpike.Native]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
  Write-Phase 'down' @{ x = $X0; y = $Y0; buttonDown = $held }
  try {
    # Past the 6 px threshold in small hops, like a hand starting to move.
    for ($i = 1; $i -le 12; $i += 1) {
      [void][MunaDragSpike.Native]::SetCursorPos($X0, $Y0 + 2 * $i)
      if ($i -eq 3) { Write-Phase 'threshold' @{ x = $X0; y = ($Y0 + 6) } }
      Start-Sleep -Milliseconds 8
    }
    $fromY = $Y0 + 24
    for ($i = 1; $i -le 24; $i += 1) {
      $x = [int]($X0 + ($X1 - $X0) * $i / 24)
      $y = [int]($fromY + ($Y1 - $fromY) * $i / 24)
      [void][MunaDragSpike.Native]::SetCursorPos($x, $y)
      Start-Sleep -Milliseconds 16
    }
    Write-Phase 'arrived' @{ x = $X1; y = $Y1 }
    # OLE re-targets on moves: jitter one pixel while dwelling so the target sees DragOver.
    $until = $clock.ElapsedMilliseconds + $HoldMs
    $j = 0
    while ($clock.ElapsedMilliseconds -lt $until) {
      [void][MunaDragSpike.Native]::SetCursorPos($X1 + ($j % 2), $Y1 + (($j -shr 1) % 2))
      $j += 1
      Start-Sleep -Milliseconds 50
    }
  } finally {
    Send-Mouse $MOUSEEVENTF_LEFTUP
    Write-Phase 'up' @{ x = $X1; y = $Y1 }
  }
  [pscustomobject]@{ done = $true }
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = @($line.Trim() -split '\s+')
  $command = $parts[0]
  try {
    switch ($command) {
      'explorer' {
        # The folder may contain spaces: everything between the command and the last four
        # numbers is the path.
        $numbers = @($parts[($parts.Count - 4)..($parts.Count - 1)] | ForEach-Object { [int]$_ })
        $folder = ($parts[1..($parts.Count - 5)] -join ' ')
        Write-Json (Open-Explorer $folder $numbers[0] $numbers[1] $numbers[2] $numbers[3])
      }
      'edge' {
        $numbers = @($parts[($parts.Count - 4)..($parts.Count - 1)] | ForEach-Object { [int]$_ })
        $page = ($parts[1..($parts.Count - 5)] -join ' ')
        Write-Json (Open-Edge $page $numbers[0] $numbers[1] $numbers[2] $numbers[3])
      }
      'title' { Write-Json ([pscustomobject]@{ title = (Get-Title ([IntPtr]([int64]$parts[1]))) }) }
      'hover' { Write-Json (Invoke-Hover ([int]$parts[1]) ([int]$parts[2]) ([int]$parts[3])) }
      'under' {
        # With the cursor on the point, the shell's poll makes the notch click-through there
        # within a sample, so the answer is the window a drop would really reach.
        [void][MunaDragSpike.Native]::SetCursorPos([int]$parts[1], [int]$parts[2])
        Start-Sleep -Milliseconds 300
        Write-Json ([pscustomobject](Get-WindowUnder ([int]$parts[1]) ([int]$parts[2])))
      }
      'drag' {
        $hold = if ($parts.Count -gt 5) { [int]$parts[5] } else { 300 }
        Write-Json (Invoke-Drag ([int]$parts[1]) ([int]$parts[2]) ([int]$parts[3]) ([int]$parts[4]) $hold)
      }
      'click' {
        [void][MunaDragSpike.Native]::SetCursorPos([int]$parts[1], [int]$parts[2])
        Start-Sleep -Milliseconds 250
        Send-Mouse $MOUSEEVENTF_LEFTDOWN
        Start-Sleep -Milliseconds 80
        Send-Mouse $MOUSEEVENTF_LEFTUP
        Write-Json ([pscustomobject]@{ done = $true })
      }
      'close' {
        $ok = [MunaDragSpike.Native]::PostMessageW([IntPtr]([int64]$parts[1]), $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
        Write-Json ([pscustomobject]@{ ok = [bool]$ok })
      }
      'kill' {
        Stop-Process -Id ([int]$parts[1]) -Force -ErrorAction SilentlyContinue
        Write-Json ([pscustomobject]@{ ok = $true })
      }
      'quit' { exit 0 }
      default { Write-Json ([pscustomobject]@{ error = "unknown command '$command'" }) }
    }
  } catch {
    Write-Json ([pscustomobject]@{ error = $_.Exception.Message })
  }
}
