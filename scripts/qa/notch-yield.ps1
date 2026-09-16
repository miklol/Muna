<#
.SYNOPSIS
Drives the ten scripted yield scenarios of docs/qa/checklists/notch-shell.md against a running
Muna and prints one PASS / FAIL / SKIP line per scenario with the measured latencies.

.DESCRIPTION
Run Muna first (scripts/dev.ps1 or an installed build) with the default layout on the primary
monitor (Overlay mode, Notch shape, 32 px strip, no offsets). The script then:

- creates its own test windows in child PowerShell processes: a white captioned window, a
  small captioned "side" window that never overlaps the strip, a dark borderless window sized
  to a whole monitor, and a white borderless backdrop behind the strip that is never activated;
- drives them with Win32 (SetForegroundWindow, ShowWindow, SetWindowPos) and synthetic input
  (a real caption drag for the move rule);
- observes the notch three ways: WindowFromPoint under a resting cursor (click-through means
  the strip yielded there), the MunaNotch window rects (parked means moved above the monitor)
  and the brightness of the strip's lower band against the white backdrop (black = strip at
  rest, bright = strip slid up to the sliver).

Nothing outside the test windows is touched; the cursor is moved and the mouse button is
pressed only over them or over the notch. Coordinates are physical pixels.

.PARAMETER Scenario
Run a subset, for example -Scenario Y2,Y3. Default: all ten.

.PARAMETER Reserved
The primary notch is in Reserved-strip mode (Settings → Layout → Placement). Detected from
settings.json when the file exists; the switch forces it. Y10 runs only in this mode; Y2, Y4
and Y5 are skipped because caption overlap does not peek in it.

.PARAMETER Report
Optional path of a Markdown file that receives the results table.

.EXAMPLE
pwsh scripts/qa/notch-yield.ps1
pwsh scripts/qa/notch-yield.ps1 -Scenario Y7,Y8,Y9 -Report out/yield.md
pwsh scripts/qa/notch-yield.ps1 -Scenario Y10 -Reserved
#>
[CmdletBinding()]
param(
  [string[]]$Scenario,
  [switch]$Reserved,
  [string]$Report,
  # Internal: this script re-launches itself as a test-window host with the parameters below.
  [Parameter(DontShow)][ValidateSet('caption', 'borderless')][string]$WindowHost,
  [Parameter(DontShow)][string]$Title = 'MunaQA',
  [Parameter(DontShow)][int]$X,
  [Parameter(DontShow)][int]$Y,
  [Parameter(DontShow)][int]$W = 400,
  [Parameter(DontShow)][int]$H = 300,
  [Parameter(DontShow)][string]$Color = '#FFFFFF',
  [Parameter(DontShow)][switch]$Minimized,
  [Parameter(DontShow)][switch]$TopMost
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace MunaQa {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
  }
  public static class Native {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFOEX info);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern IntPtr SetWindowLongPtrW(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attr, out RECT rect, int size);
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    // One consistent snapshot of every top-level window of a class (FindWindowEx walks the live
    // z-order, which the notch re-asserts while we enumerate).
    public static System.Collections.Generic.List<IntPtr> FindAllOfClass(string cls) {
      var found = new System.Collections.Generic.List<IntPtr>();
      EnumWindows((hwnd, l) => {
        var name = new StringBuilder(256);
        GetClassName(hwnd, name, 256);
        if (name.ToString() == cls) found.Add(hwnd);
        return true;
      }, IntPtr.Zero);
      return found;
    }
  }
}
'@

# Per-monitor DPI awareness (v2) like Muna itself, so every coordinate below is a physical pixel
# on every monitor. A System-DPI-aware process would see monitors with another scale factor in
# virtualised coordinates and misjudge the parked position by a rounded pixel.
if (-not [MunaQa.Native]::SetProcessDpiAwarenessContext([IntPtr](-4))) {
  [void][MunaQa.Native]::SetProcessDPIAware()
}

# ---------------------------------------------------------------------------------------------
# Test-window host (child process): a plain WinForms window, captioned or borderless, one colour.
# ---------------------------------------------------------------------------------------------
if ($WindowHost) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $Title
  $form.StartPosition = 'Manual'
  $form.FormBorderStyle = if ($WindowHost -eq 'caption') { 'Sizable' } else { 'None' }
  $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml($Color)
  $form.ShowInTaskbar = $WindowHost -eq 'caption'
  $form.TopMost = [bool]$TopMost
  $bounds = New-Object System.Drawing.Rectangle($X, $Y, $W, $H)
  $form.Bounds = $bounds
  if ($Minimized) { $form.WindowState = 'Minimized' }
  # The driver starts this host with -WindowStyle Hidden to keep the console away, and Windows
  # applies that STARTUPINFO show state to the process's *first* ShowWindow call — which is the
  # one WinForms makes. Show the form again explicitly, without activating it, or every test
  # window would be an invisible rect and the synthetic clicks would land on real windows.
  $show = if ($Minimized) { 7 } else { 8 }   # SW_SHOWMINNOACTIVE / SW_SHOWNA
  $form.Add_Shown({
      $form.Bounds = $bounds
      if (-not [MunaQa.Native]::IsWindowVisible($form.Handle)) { [void][MunaQa.Native]::ShowWindow($form.Handle, $show) }
    }.GetNewClosure())
  [System.Windows.Forms.Application]::Run($form)
  return
}

Add-Type -AssemblyName System.Drawing

# ---------------------------------------------------------------------------------------------
# Win32 helpers
# ---------------------------------------------------------------------------------------------
$SW_MINIMIZE = 6; $SW_RESTORE = 9; $SW_MAXIMIZE = 3
$SWP_NOZORDER = 0x0004
$GWL_EXSTYLE = -20; $WS_EX_NOACTIVATE = 0x08000000; $WS_EX_TOOLWINDOW = 0x00000080
$MOUSEEVENTF_MOVE = 0x0001; $MOUSEEVENTF_LEFTDOWN = 0x0002; $MOUSEEVENTF_LEFTUP = 0x0004
$DWMWA_EXTENDED_FRAME_BOUNDS = 9

function Move-Cursor([int]$x, [int]$y) {
  [void][MunaQa.Native]::SetCursorPos($x, $y)
  # A zero relative move makes the window under the cursor receive WM_MOUSEMOVE.
  [MunaQa.Native]::mouse_event($MOUSEEVENTF_MOVE, 0, 0, 0, [UIntPtr]::Zero)
}
function Press-Button { [MunaQa.Native]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero) }
function Release-Button { [MunaQa.Native]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero) }
function Click-At([int]$x, [int]$y) {
  Move-Cursor $x $y
  Start-Sleep -Milliseconds 30
  Press-Button
  Start-Sleep -Milliseconds 40
  Release-Button
}
function Get-Rect([IntPtr]$hwnd) {
  $r = New-Object MunaQa.RECT
  [void][MunaQa.Native]::GetWindowRect($hwnd, [ref]$r)
  $r
}
function Get-FrameRect([IntPtr]$hwnd) {
  $r = New-Object MunaQa.RECT
  $size = [System.Runtime.InteropServices.Marshal]::SizeOf([type][MunaQa.RECT])
  if ([MunaQa.Native]::DwmGetWindowAttribute($hwnd, $DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$r, $size) -ne 0) {
    $r = Get-Rect $hwnd
  }
  $r
}
function Get-Monitor([IntPtr]$hwnd) {
  $info = New-Object MunaQa.MONITORINFOEX
  $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][MunaQa.MONITORINFOEX])
  $monitor = [MunaQa.Native]::MonitorFromWindow($hwnd, 2)   # MONITOR_DEFAULTTONEAREST
  [void][MunaQa.Native]::GetMonitorInfoW($monitor, [ref]$info)
  [pscustomobject]@{
    Device  = $info.szDevice
    Primary = ($info.dwFlags -band 1) -eq 1
    Left    = $info.rcMonitor.Left
    Top     = $info.rcMonitor.Top
    Right   = $info.rcMonitor.Right
    Bottom  = $info.rcMonitor.Bottom
    Width   = $info.rcMonitor.Right - $info.rcMonitor.Left
    Height  = $info.rcMonitor.Bottom - $info.rcMonitor.Top
    WorkTop = $info.rcWork.Top
  }
}
function Get-RootClass([int]$x, [int]$y) {
  $p = New-Object MunaQa.POINT
  $p.X = $x
  $p.Y = $y
  $root = [MunaQa.Native]::GetAncestor([MunaQa.Native]::WindowFromPoint($p), 2)
  $name = New-Object System.Text.StringBuilder 256
  [void][MunaQa.Native]::GetClassName($root, $name, 256)
  $name.ToString()
}
function Get-RootWindow([int]$x, [int]$y) {
  $p = New-Object MunaQa.POINT
  $p.X = $x
  $p.Y = $y
  [MunaQa.Native]::GetAncestor([MunaQa.Native]::WindowFromPoint($p), 2)
}
function Wait-Until([scriptblock]$Condition, [int]$TimeoutMs, [int]$PollMs = 10) {
  # Elapsed ms when the condition first holds, or -1 on timeout.
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    if (& $Condition) { return [int]$sw.ElapsedMilliseconds }
    Start-Sleep -Milliseconds $PollMs
  }
  -1
}
function Set-Foreground([IntPtr]$hwnd) {
  # The driver injected the last input event, so SetForegroundWindow is allowed; an Alt tap is
  # the usual fallback when it is not.
  if ([MunaQa.Native]::IsIconic($hwnd)) { [void][MunaQa.Native]::ShowWindow($hwnd, $SW_RESTORE) }
  if (-not [MunaQa.Native]::SetForegroundWindow($hwnd)) {
    [MunaQa.Native]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [MunaQa.Native]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][MunaQa.Native]::SetForegroundWindow($hwnd)
  }
  $ok = Wait-Until { [MunaQa.Native]::GetForegroundWindow() -eq $hwnd } 1000
  if ($ok -lt 0) { throw "could not bring window $hwnd to the foreground" }
}

# ---------------------------------------------------------------------------------------------
# The notch
# ---------------------------------------------------------------------------------------------
function Get-Notches {
  $result = @()
  foreach ($hwnd in [MunaQa.Native]::FindAllOfClass('MunaNotch')) {
    $rect = Get-Rect $hwnd
    $monitor = Get-Monitor $hwnd
    $dpi = [MunaQa.Native]::GetDpiForWindow($hwnd)
    $result += [pscustomobject]@{
      Hwnd    = $hwnd
      Rect    = $rect
      Monitor = $monitor
      Scale   = $(if ($dpi -gt 0) { $dpi / 96.0 } else { 1.0 })
      Parked  = $rect.Bottom -le $monitor.Top
    }
  }
  $result
}
function Get-Layout([string]$device) {
  # The monitor's layout from %LOCALAPPDATA%\Muna\settings.json (shell.monitors[id] over
  # shell.defaults); the built-in defaults when the file does not exist yet.
  $layout = [ordered]@{ mode = 'overlay'; shape = 'notch'; offsetX = 0; offsetY = 0; stripHeight = 'default' }
  $path = Join-Path $env:LOCALAPPDATA 'Muna\settings.json'
  if (Test-Path $path) {
    $shell = (Get-Content $path -Raw | ConvertFrom-Json).shell
    foreach ($source in @($shell.defaults, $shell.monitors.$device)) {
      if ($null -eq $source) { continue }
      foreach ($key in @($layout.Keys)) {
        if ($null -ne $source.$key) { $layout[$key] = $source.$key }
      }
    }
  }
  [pscustomobject]$layout
}
function Get-StripGeometry($notch, $layout) {
  # Strip 200 CSS px wide, centred in the window (plus the horizontal offset), below the
  # window's top edge by the vertical offset and the shape's top offset (Island floats 8 px).
  # Probe rows: the lower band of the strip (outside the shape once it peeks) and the 6 px
  # sliver at the top edge that stays interactive while peeking.
  $s = $notch.Scale
  $heights = @{ compact = 26; default = 32; comfortable = 38 }
  $width = [int][math]::Round(200 * $s)
  $height = [int][math]::Round($heights[[string]$layout.stripHeight] * $s)
  $shapeOffset = if ($layout.shape -eq 'island') { 8 } else { 0 }
  $centreX = [int](($notch.Rect.Left + $notch.Rect.Right) / 2)
  # The placed window's top edge already carries the vertical offset; when parked, fall back
  # to the monitor's top edge plus the offset from settings.
  $windowTop = if ($notch.Parked) { $notch.Monitor.Top + [int][math]::Round($layout.offsetY * $s) } else { $notch.Rect.Top }
  $top = $windowTop + [int][math]::Round($shapeOffset * $s)
  [pscustomobject]@{
    CentreX    = $centreX
    Top        = $top
    Bottom     = $top + $height
    Left       = $centreX - [int]($width / 2)
    Right      = $centreX + [int]($width / 2)
    Width      = $width
    Height     = $height
    ProbeY     = $top + [int](0.8 * $height)
    SliverY    = $notch.Monitor.Top + [int](3 * $s)
    BandTop    = $top + [int](0.55 * $height)
    BandBottom = $top + [int](0.95 * $height)
  }
}
function Get-BandBrightness($strip) {
  # Mean luminance (0–255) of the strip's lower band: the notch paints it black, the white
  # backdrop (or a white maximised window) shows through once the strip has slid up.
  $w = $strip.Width - [int](0.4 * $strip.Width)
  $h = $strip.BandBottom - $strip.BandTop
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen(($strip.Left + [int](0.2 * $strip.Width)), $strip.BandTop, 0, 0, $bmp.Size)
  $g.Dispose()
  $sum = 0.0
  $n = 0
  for ($y = 0; $y -lt $h; $y += 2) {
    for ($x = 0; $x -lt $w; $x += 6) {
      $c = $bmp.GetPixel($x, $y)
      $sum += 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      $n++
    }
  }
  $bmp.Dispose()
  if ($n -eq 0) { 0 } else { [int]($sum / $n) }
}
function Test-Yielded($strip) { (Get-BandBrightness $strip) -gt 110 }
function Test-AtRest($strip) { (Get-BandBrightness $strip) -lt 60 }
function Test-Parked([IntPtr]$hwnd) {
  $rect = Get-Rect $hwnd
  $monitor = Get-Monitor $hwnd
  $rect.Bottom -le $monitor.Top
}
function Park-Cursor($notch) {
  # Low on the same monitor, outside every shape: the notch is click-through there and no
  # hover intent runs.
  Move-Cursor ([int](($notch.Monitor.Left + $notch.Monitor.Right) / 2)) ($notch.Monitor.Bottom - 300)
}

# ---------------------------------------------------------------------------------------------
# Test windows
# ---------------------------------------------------------------------------------------------
$hostExe = Join-Path $PSHOME $(if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' })
$script:children = @()
function Start-TestWindow([string]$kind, [string]$title, [int]$x, [int]$y, [int]$w, [int]$h, [string]$color, [switch]$minimized, [switch]$topMost) {
  $argumentList = @('-NoProfile', '-STA', '-File', $PSCommandPath, '-WindowHost', $kind, '-Title', $title,
    '-X', $x, '-Y', $y, '-W', $w, '-H', $h, '-Color', $color)
  if ($minimized) { $argumentList += '-Minimized' }
  if ($topMost) { $argumentList += '-TopMost' }
  $script:children += Start-Process -FilePath $hostExe -ArgumentList $argumentList -PassThru -WindowStyle Hidden
  $script:found = [IntPtr]::Zero
  $appeared = Wait-Until { $script:found = [MunaQa.Native]::FindWindowW([NullString]::Value, $title); $script:found -ne [IntPtr]::Zero } 8000 50
  if ($appeared -lt 0) { throw "test window '$title' did not appear" }
  $hwnd = $script:found
  # Hidden test windows would let the synthetic input reach real windows underneath: refuse.
  $visible = Wait-Until { [MunaQa.Native]::IsWindowVisible($hwnd) -or ($minimized -and [MunaQa.Native]::IsIconic($hwnd)) } 3000 50
  if ($visible -lt 0) { throw "test window '$title' is not visible" }
  Start-Sleep -Milliseconds 300
  $hwnd
}
function Stop-TestWindows {
  foreach ($child in $script:children) {
    try { if (-not $child.HasExited) { $child.Kill() } } catch { Write-Verbose "kill failed: $_" }
  }
  $script:children = @()
}

# ---------------------------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------------------------
$results = New-Object System.Collections.Generic.List[object]
function Record([string]$id, [string]$name, [string]$verdict, [string]$note) {
  $results.Add([pscustomobject]@{ Id = $id; Scenario = $name; Result = $verdict; Measured = $note })
  $colour = switch ($verdict) { 'PASS' { 'Green' } 'FAIL' { 'Red' } default { 'Yellow' } }
  Write-Host ('{0,-4} ' -f $id) -NoNewline
  Write-Host ('{0,-5}' -f $verdict) -ForegroundColor $colour -NoNewline
  Write-Host (' {0} — {1}' -f $name, $note)
}
function Should-Run([string]$id) { -not $Scenario -or ($Scenario -contains $id) }
function Verdict([bool]$pass) { if ($pass) { 'PASS' } else { 'FAIL' } }
# `pwsh -File … -Scenario Y1,Y2` hands the list over as one string.
$Scenario = @($Scenario | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToUpperInvariant() } | Where-Object { $_ })

# ---------------------------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------------------------
$notches = Get-Notches
if (-not $notches) { throw 'no MunaNotch window found: start Muna first (scripts/dev.ps1)' }
$primary = $notches | Where-Object { $_.Monitor.Primary } | Select-Object -First 1
if (-not $primary) { throw 'no notch on the primary monitor' }
$secondary = $notches | Where-Object { -not $_.Monitor.Primary } | Select-Object -First 1
$layout = Get-Layout $primary.Monitor.Device
if ($layout.mode -eq 'reserved') { $Reserved = $true }
$strip = Get-StripGeometry $primary $layout
$mon = $primary.Monitor
$s = $primary.Scale

Write-Host ('Muna notch windows: {0}; primary {1} {2}x{3} at {4} %; layout {5} / {6} / {7} (strip {8} px high at y {9}, x {10}-{11})' -f
  $notches.Count, $mon.Device, $mon.Width, $mon.Height, [int]($s * 100), $layout.mode, $layout.shape, $layout.stripHeight, $strip.Height, $strip.Top, $strip.Left, $strip.Right)
if ($secondary) {
  Write-Host ('secondary {0} {1}x{2} at ({3},{4})' -f $secondary.Monitor.Device, $secondary.Monitor.Width, $secondary.Monitor.Height, $secondary.Monitor.Left, $secondary.Monitor.Top)
}

try {
  $captionW = [int](900 * $s)
  $captionH = [int](600 * $s)
  $captionX = $mon.Left + [int](($mon.Width - $captionW) / 2) - [int](200 * $s)
  $captionY = $mon.Top + [int](260 * $s)
  $caption = Start-TestWindow caption 'MunaQA-caption' $captionX $captionY $captionW $captionH '#FFFFFF'

  if ($secondary) {
    $sm = $secondary.Monitor
    $side = Start-TestWindow caption 'MunaQA-side' ($sm.Left + 120) ($sm.Top + 300) 420 260 '#DDE6F0'
  } else {
    $side = Start-TestWindow caption 'MunaQA-side' ($mon.Left + 40) ($mon.Bottom - 420) 420 260 '#DDE6F0' -topMost
  }

  $fullscreen = Start-TestWindow borderless 'MunaQA-fullscreen' $mon.Left $mon.Top $mon.Width $mon.Height '#101010' -minimized

  $backdrop = Start-TestWindow borderless 'MunaQA-backdrop' ($strip.Left - [int](120 * $s)) $mon.Top ($strip.Width + [int](240 * $s)) ($strip.Height + [int](60 * $s)) '#FFFFFF'
  $ex = [MunaQa.Native]::GetWindowLongPtrW($backdrop, $GWL_EXSTYLE).ToInt64()
  [void][MunaQa.Native]::SetWindowLongPtrW($backdrop, $GWL_EXSTYLE, [IntPtr]($ex -bor $WS_EX_NOACTIVATE -bor $WS_EX_TOOLWINDOW))

  Set-Foreground $caption
  Park-Cursor $primary
  Start-Sleep -Milliseconds 1200

  # Y1 · Nothing in the way -------------------------------------------------------------------
  if (Should-Run 'Y1') {
    Set-Foreground $caption
    Start-Sleep -Milliseconds 800
    $rest = Test-AtRest $strip
    Move-Cursor $strip.CentreX $strip.ProbeY
    $centre = Wait-Until { (Get-RootClass $strip.CentreX $strip.ProbeY) -eq 'MunaNotch' } 600
    Move-Cursor $strip.CentreX $strip.SliverY
    $sliver = Wait-Until { (Get-RootClass $strip.CentreX $strip.SliverY) -eq 'MunaNotch' } 600
    Park-Cursor $primary
    $placed = -not (Test-Parked $primary.Hwnd)
    Record 'Y1' 'Nothing in the way' (Verdict ($rest -and $centre -ge 0 -and $sliver -ge 0 -and $placed)) `
      ('strip black at rest: {0}; MunaNotch under the cursor at the strip: {1}, at the sliver: {2}; window placed: {3}' -f $rest, ($centre -ge 0), ($sliver -ge 0), $placed)
    Start-Sleep -Milliseconds 1500   # let any hover intent lapse
  }

  # Y2 · A maximised window takes the foreground → Peek within 100 ms (foreground event) --------
  if (Should-Run 'Y2') {
    if ($Reserved) {
      Record 'Y2' 'Maximised window takes the foreground' 'SKIP' 'caption overlap does not peek in Reserved-strip mode'
    } else {
      [void][MunaQa.Native]::ShowWindow($caption, $SW_MAXIMIZE)
      Start-Sleep -Milliseconds 1200          # the poll path peeks; clear it via the side window
      Set-Foreground $side
      $back = Wait-Until { Test-AtRest $strip } 3000 30
      # Rest the cursor on the strip's lower band (interactive at rest) and switch the foreground
      # to the maximised window without touching the mouse; the band turns click-through once
      # Rust moves the hit rect up to the sliver.
      Move-Cursor $strip.CentreX $strip.ProbeY
      $armed = Wait-Until { (Get-RootClass $strip.CentreX $strip.ProbeY) -eq 'MunaNotch' } 600
      [void][MunaQa.Native]::SetForegroundWindow($caption)
      $peek = Wait-Until { (Get-RootClass $strip.CentreX $strip.ProbeY) -ne 'MunaNotch' } 1500 5
      Move-Cursor $strip.CentreX $strip.SliverY
      $sliver = Wait-Until { (Get-RootClass $strip.CentreX $strip.SliverY) -eq 'MunaNotch' } 600
      Park-Cursor $primary
      $visual = Wait-Until { Test-Yielded $strip } 1500 20
      Record 'Y2' 'Maximised window takes the foreground' (Verdict ($back -ge 0 -and $armed -ge 0 -and $peek -ge 0 -and $peek -le 100 -and $sliver -ge 0 -and $visual -ge 0)) `
        ('hit rect left the strip {0} ms after the foreground change (criterion ≤ 100 ms); sliver still MunaNotch: {1}; strip visibly up: {2}' -f $peek, ($sliver -ge 0), ($visual -ge 0))
    }
  }

  # Y3 · Foreground moves elsewhere (side window, then the desktop) → strip returns, never parks
  if (Should-Run 'Y3') {
    if (-not $Reserved) {
      [void][MunaQa.Native]::ShowWindow($caption, $SW_MAXIMIZE)
      Set-Foreground $caption
      Start-Sleep -Milliseconds 1200
    }
    Set-Foreground $side
    $return = Wait-Until { Test-AtRest $strip } 3000 20
    # The desktop: restore the test window out of the way and click an empty spot low on the
    # primary monitor. Progman / WorkerW are borderless and cover the monitor, so this is the
    # false-positive check for the fullscreen heuristic. The click only happens when the desktop
    # really is under the cursor (never on a real window).
    [void][MunaQa.Native]::ShowWindow($caption, $SW_RESTORE)
    Start-Sleep -Milliseconds 400
    $deskX = $mon.Left + [int](60 * $s)
    $deskY = $mon.Bottom - [int](160 * $s)
    Move-Cursor $deskX $deskY
    Start-Sleep -Milliseconds 60
    $fgClass = Get-RootClass $deskX $deskY
    $desktopUnderCursor = $fgClass -in 'Progman', 'WorkerW'
    if ($desktopUnderCursor) {
      Click-At $deskX $deskY
      Start-Sleep -Milliseconds 80
    }
    Park-Cursor $primary
    $parkedWithin = Wait-Until { Test-Parked $primary.Hwnd } 1800 50
    $restOnDesktop = Test-AtRest $strip
    Set-Foreground $caption
    $desktopNote = if ($desktopUnderCursor) { 'desktop foreground ({0}): parked within 1.8 s: {1}, strip at rest: {2}' -f $fgClass, ($parkedWithin -ge 0), $restOnDesktop } else { 'desktop check skipped: {0} covers the spot' -f $fgClass }
    Record 'Y3' 'Foreground moves elsewhere' (Verdict ($return -ge 0 -and $parkedWithin -lt 0 -and $restOnDesktop)) `
      ('strip back {0} ms after the side window took the foreground (incl. slide); {1}' -f $return, $desktopNote)
  }

  # Y4 · Maximising the already-foreground window → Peek via the 500 ms poll -------------------
  if (Should-Run 'Y4') {
    if ($Reserved) {
      Record 'Y4' 'Maximise the foreground window' 'SKIP' 'caption overlap does not peek in Reserved-strip mode'
    } else {
      [void][MunaQa.Native]::ShowWindow($caption, $SW_RESTORE)
      Set-Foreground $caption
      Park-Cursor $primary
      $rest = Wait-Until { Test-AtRest $strip } 3000 30
      [void][MunaQa.Native]::ShowWindow($caption, $SW_MAXIMIZE)
      $peek = Wait-Until { Test-Yielded $strip } 2000 20
      Record 'Y4' 'Maximise the foreground window' (Verdict ($rest -ge 0 -and $peek -ge 0 -and $peek -le 1000)) `
        ('strip visibly up {0} ms after SW_MAXIMIZE (poll ≤ 500 ms + slide)' -f $peek)
      [void][MunaQa.Native]::ShowWindow($caption, $SW_RESTORE)
      Start-Sleep -Milliseconds 1200
    }
  }

  # Y5 · Overlap threshold: 30 % of the strip does not peek, 50 % does --------------------------
  if (Should-Run 'Y5') {
    if ($Reserved) {
      Record 'Y5' 'Caption overlap threshold' 'SKIP' 'caption overlap does not peek in Reserved-strip mode'
    } else {
      [void][MunaQa.Native]::ShowWindow($caption, $SW_RESTORE)
      $w = [int](700 * $s)
      $h = [int](400 * $s)
      # Right edge at 30 % of the strip's width, top edge at the monitor's top.
      $x30 = $strip.Left + [int](0.30 * $strip.Width) - $w
      [void][MunaQa.Native]::SetWindowPos($caption, [IntPtr]::Zero, $x30, $mon.Top, $w, $h, $SWP_NOZORDER)
      Set-Foreground $caption
      Park-Cursor $primary
      $peek30 = Wait-Until { Test-Yielded $strip } 1500 30
      # Move to 50 %: no foreground event, the quiet-state poll re-samples the rect.
      $x50 = $strip.Left + [int](0.50 * $strip.Width) - $w
      [void][MunaQa.Native]::SetWindowPos($caption, [IntPtr]::Zero, $x50, $mon.Top, $w, $h, $SWP_NOZORDER)
      $peek50 = Wait-Until { Test-Yielded $strip } 2000 20
      Record 'Y5' 'Caption overlap threshold' (Verdict ($peek30 -lt 0 -and $peek50 -ge 0)) `
        ('30 % overlap peeked within 1.5 s: {0}; 50 % overlap peeked after {1} ms' -f ($peek30 -ge 0), $peek50)
      [void][MunaQa.Native]::SetWindowPos($caption, [IntPtr]::Zero, $captionX, $captionY, $captionW, $captionH, $SWP_NOZORDER)
      Start-Sleep -Milliseconds 1200
    }
  }

  # Y6 · Dragging any window → Peek for the whole drag, in both modes ---------------------------
  if (Should-Run 'Y6') {
    [void][MunaQa.Native]::ShowWindow($caption, $SW_RESTORE)
    [void][MunaQa.Native]::SetWindowPos($caption, [IntPtr]::Zero, $captionX, $captionY, $captionW, $captionH, $SWP_NOZORDER)
    Set-Foreground $caption
    Park-Cursor $primary
    $rest = Wait-Until { Test-AtRest $strip } 3000 30
    $frame = Get-FrameRect $caption
    $grabX = $frame.Left + [int](($frame.Right - $frame.Left) * 0.6)
    $grabY = $frame.Top + [int](14 * $s)
    Move-Cursor $grabX $grabY
    Start-Sleep -Milliseconds 100
    if ((Get-RootWindow $grabX $grabY) -ne $caption) {
      Record 'Y6' 'Window drag' 'SKIP' ('{0} covers the test window''s caption at ({1},{2}); not pressing there' -f (Get-RootClass $grabX $grabY), $grabX, $grabY)
    } else {
      Press-Button
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      for ($i = 1; $i -le 6; $i++) {
        Move-Cursor ($grabX + 12 * $i) ($grabY + 6 * $i)
        Start-Sleep -Milliseconds 25
      }
      $peek = Wait-Until { Test-Yielded $strip } 1500 20
      $peekAt = [int]$sw.ElapsedMilliseconds
      Start-Sleep -Milliseconds 600
      $stillPeeking = Test-Yielded $strip
      $moved = (Get-FrameRect $caption).Left -ne $frame.Left
      Release-Button
      $back = Wait-Until { Test-AtRest $strip } 2000 20
      [void][MunaQa.Native]::SetWindowPos($caption, [IntPtr]::Zero, $captionX, $captionY, $captionW, $captionH, $SWP_NOZORDER)
      Park-Cursor $primary
      Record 'Y6' 'Window drag' (Verdict ($rest -ge 0 -and $moved -and $peek -ge 0 -and $stillPeeking -and $back -ge 0)) `
        ('window moved: {0}; strip up {1} ms after the drag began, still up after 600 ms: {2}; back {3} ms after release' -f $moved, $peekAt, $stillPeeking, $back)
    }
    Start-Sleep -Milliseconds 800
  }

  # Y7 · Borderless fullscreen window on the primary monitor → Park after the 500 ms debounce --
  if (Should-Run 'Y7') {
    Set-Foreground $caption
    Park-Cursor $primary
    Start-Sleep -Milliseconds 800
    $placedBefore = -not (Test-Parked $primary.Hwnd)
    Set-Foreground $fullscreen
    $park = Wait-Until { Test-Parked $primary.Hwnd } 3000 10
    [void][MunaQa.Native]::ShowWindow($fullscreen, $SW_MINIMIZE)
    Set-Foreground $caption
    $unpark = Wait-Until { -not (Test-Parked $primary.Hwnd) } 3000 10
    Record 'Y7' 'Fullscreen parks the notch' (Verdict ($placedBefore -and $park -ge 0 -and $park -le 1500 -and $unpark -ge 0 -and $unpark -le 1500)) `
      ('parked {0} ms after the fullscreen window took the foreground (debounce 500 ms); placed again {1} ms after it left' -f $park, $unpark)
    Start-Sleep -Milliseconds 800
  }

  # Y8 · Fullscreen on the other monitor parks only that notch ----------------------------------
  if (Should-Run 'Y8') {
    if (-not $secondary) {
      Record 'Y8' 'Fullscreen on the other monitor' 'SKIP' 'one monitor only'
    } else {
      $sm = $secondary.Monitor
      $fs2 = Start-TestWindow borderless 'MunaQA-fullscreen-2' $sm.Left $sm.Top $sm.Width $sm.Height '#101010' -minimized
      Set-Foreground $caption
      Start-Sleep -Milliseconds 800
      Set-Foreground $fs2
      $script:primaryParked = $false
      $park2 = Wait-Until { $script:primaryParked = $script:primaryParked -or (Test-Parked $primary.Hwnd); Test-Parked $secondary.Hwnd } 3000 10
      Start-Sleep -Milliseconds 700
      $script:primaryParked = $script:primaryParked -or (Test-Parked $primary.Hwnd)
      [void][MunaQa.Native]::ShowWindow($fs2, $SW_MINIMIZE)
      Set-Foreground $caption
      $unpark2 = Wait-Until { -not (Test-Parked $secondary.Hwnd) } 3000 10
      Record 'Y8' 'Fullscreen on the other monitor' (Verdict ($park2 -ge 0 -and -not $script:primaryParked -and $unpark2 -ge 0)) `
        ('secondary parked after {0} ms, primary parked meanwhile: {1}; secondary placed again after {2} ms' -f $park2, $script:primaryParked, $unpark2)
      Start-Sleep -Milliseconds 800
    }
  }

  # Y9 · Flapping fullscreen never flickers; a held fullscreen still parks ----------------------
  if (Should-Run 'Y9') {
    Set-Foreground $caption
    Park-Cursor $primary
    Start-Sleep -Milliseconds 800
    $flickered = $false
    for ($i = 0; $i -lt 4; $i++) {
      Set-Foreground $fullscreen
      if ((Wait-Until { Test-Parked $primary.Hwnd } 200 10) -ge 0) { $flickered = $true }
      [void][MunaQa.Native]::ShowWindow($fullscreen, $SW_MINIMIZE)
      Set-Foreground $caption
      if ((Wait-Until { Test-Parked $primary.Hwnd } 200 10) -ge 0) { $flickered = $true }
    }
    Set-Foreground $fullscreen
    $park = Wait-Until { Test-Parked $primary.Hwnd } 3000 10
    [void][MunaQa.Native]::ShowWindow($fullscreen, $SW_MINIMIZE)
    Set-Foreground $caption
    $unpark = Wait-Until { -not (Test-Parked $primary.Hwnd) } 3000 10
    Record 'Y9' 'Flapping fullscreen' (Verdict (-not $flickered -and $park -ge 0 -and $unpark -ge 0)) `
      ('parked during 4 × (200 ms fullscreen / 200 ms away): {0}; held fullscreen parked after {1} ms; placed again after {2} ms' -f $flickered, $park, $unpark)
    Start-Sleep -Milliseconds 800
  }

  # Y10 · Reserved-strip mode: a maximised window stops at the strip's bottom and nothing peeks
  if (Should-Run 'Y10') {
    if (-not $Reserved) {
      Record 'Y10' 'Reserved-strip mode' 'SKIP' 'switch Settings → Layout → Placement to Reserved strip and run with -Reserved'
    } else {
      [void][MunaQa.Native]::ShowWindow($caption, $SW_MAXIMIZE)
      Set-Foreground $caption
      Park-Cursor $primary
      Start-Sleep -Milliseconds 1500
      $frame = Get-FrameRect $caption
      $workTop = (Get-Monitor $primary.Hwnd).WorkTop
      $peeked = Test-Yielded $strip
      Record 'Y10' 'Reserved-strip mode' (Verdict ($frame.Top -eq $strip.Bottom -and $workTop -eq $strip.Bottom -and -not $peeked)) `
        ('maximised frame top {0}, work area top {1}, strip bottom {2}; strip slid up: {3}' -f $frame.Top, $workTop, $strip.Bottom, $peeked)
      [void][MunaQa.Native]::ShowWindow($caption, $SW_RESTORE)
    }
  }
}
finally {
  Stop-TestWindows
}

Write-Host ''
$results | Format-Table -AutoSize | Out-String -Width 220 | Write-Host
if ($Report) {
  $lines = @('| Id | Scenario | Result | Measured |', '| --- | --- | --- | --- |')
  $lines += $results | ForEach-Object { '| {0} | {1} | {2} | {3} |' -f $_.Id, $_.Scenario, $_.Result, $_.Measured }
  Set-Content -Path $Report -Value $lines -Encoding UTF8
  Write-Host "report written to $Report"
}
exit @($results | Where-Object Result -eq 'FAIL').Count
