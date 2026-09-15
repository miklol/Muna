<#
.SYNOPSIS
  Shared helpers for the M0-E2 window-spike measurements (docs/spikes/m0-window.md).
.DESCRIPTION
  Dot-source this file. It starts the release build with `MUNA_SPIKE=window`, tails the JSONL
  the spike writes to %LOCALAPPDATA%\Muna\spike\window.jsonl, captures screen regions
  DPI-aware, and exposes the Win32 calls the criteria need (WindowFromPoint, z-order walk,
  SHQueryUserNotificationState). Nothing here is part of the shipped app.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$script:SpikeExe = Join-Path $RepoRoot 'apps\desktop\src-tauri\target\release\muna.exe'
$script:SpikeLog = Join-Path $env:LOCALAPPDATA 'Muna\spike\window.jsonl'
$script:ResultsDir = Join-Path $RepoRoot 'apps\desktop\src-tauri\target\spike-results'

Add-Type -AssemblyName System.Drawing
Add-Type -Namespace MunaSpike -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
[DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr hwnd, int index);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
[DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hwnd);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
[DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
[DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr hdc, int x, int y);
[DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
'@

# Per-monitor-v2 so every coordinate below is a physical pixel.
[void][MunaSpike.Native]::SetProcessDpiAwarenessContext([IntPtr](-4))

# Pixel maths compiled once: PowerShell loops over 57 KB frames are ~1000× too slow for 60 Hz.
Add-Type -Namespace MunaSpike -Name Pixels -MemberDefinition @'
/// Fraction of BGRA pixels with every channel below `threshold`.
public static double BlackFraction(byte[] bgra, int threshold) {
  int black = 0, total = bgra.Length / 4;
  for (int i = 0; i < bgra.Length; i += 4)
    if (bgra[i] < threshold && bgra[i + 1] < threshold && bgra[i + 2] < threshold) black++;
  return total == 0 ? 0 : (double)black / total;
}
/// Fraction of pixels whose colour differs between two equal-size BGRA buffers by more than `tolerance` on any channel.
public static double DiffFraction(byte[] a, byte[] b, int tolerance) {
  if (a.Length != b.Length) return 1.0;
  int diff = 0, total = a.Length / 4;
  for (int i = 0; i < a.Length; i += 4)
    if (System.Math.Abs(a[i] - b[i]) > tolerance || System.Math.Abs(a[i + 1] - b[i + 1]) > tolerance || System.Math.Abs(a[i + 2] - b[i + 2]) > tolerance) diff++;
  return total == 0 ? 0 : (double)diff / total;
}
/// Mean of the RGB channels, 0–255.
public static double MeanBrightness(byte[] bgra) {
  long sum = 0; int total = bgra.Length / 4;
  for (int i = 0; i < bgra.Length; i += 4) sum += bgra[i] + bgra[i + 1] + bgra[i + 2];
  return total == 0 ? 0 : (double)sum / (total * 3);
}
'@

function Get-SpikeExe {
  if (-not (Test-Path $script:SpikeExe)) {
    throw "Release build missing: $script:SpikeExe. Run 'pnpm --filter @muna/desktop tauri build --no-bundle'."
  }
  $script:SpikeExe
}

function Get-DescendantProcessIds([int]$RootPid) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = New-Object System.Collections.Generic.List[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($RootPid)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    $ids.Add($current)
    foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $current }) { $queue.Enqueue([int]$child.ProcessId) }
  }
  $ids
}

<#
  Starts muna.exe in spike mode. Returns the Process. `-Env` adds MUNA_SPIKE_* knobs.
  The JSONL is deleted first so every run starts clean.
#>
function Start-Spike {
  param([hashtable]$Env = @{})
  Stop-Spike
  if (Test-Path $script:SpikeLog) { Remove-Item $script:SpikeLog -Force }
  $exe = Get-SpikeExe
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.UseShellExecute = $false
  # The log plugin mirrors everything to stdout; drain it so the pipe never fills.
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.EnvironmentVariables['MUNA_SPIKE'] = 'window'
  $psi.EnvironmentVariables['WEBVIEW2_DEFAULT_BACKGROUND_COLOR'] = '00000000'
  foreach ($key in $Env.Keys) { $psi.EnvironmentVariables[$key] = [string]$Env[$key] }
  $process = [System.Diagnostics.Process]::Start($psi)
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()
  $process
}

function Stop-Spike {
  foreach ($p in Get-Process -Name muna -ErrorAction SilentlyContinue) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 300
}

function Read-SpikeLog {
  if (-not (Test-Path $script:SpikeLog)) { return @() }
  # Shared read: the spike keeps the file open for appending.
  $stream = [System.IO.File]::Open($script:SpikeLog, 'Open', 'Read', 'ReadWrite')
  try {
    $reader = New-Object System.IO.StreamReader($stream)
    $lines = @()
    while (-not $reader.EndOfStream) {
      $line = $reader.ReadLine()
      if ($line.Trim()) { $lines += ($line | ConvertFrom-Json) }
    }
    $lines
  } finally { $stream.Dispose() }
}

<# Blocks until an event with the given name (and optional predicate) appears or the timeout elapses. #>
function Wait-SpikeEvent {
  param(
    [Parameter(Mandatory)][string]$Event,
    [scriptblock]$Where = { $true },
    [int]$TimeoutMs = 15000,
    [int]$MinCount = 1
  )
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    $matches = @(Read-SpikeLog | Where-Object { $_.event -eq $Event } | Where-Object $Where)
    if ($matches.Count -ge $MinCount) { return $matches }
    Start-Sleep -Milliseconds 25
  }
  throw "Timed out after ${TimeoutMs} ms waiting for spike event '$Event'."
}

<# The primary notch window's current strip rect in physical pixels, from the last `shapes` event. #>
# Screen rect (physical px) of the primary window's first painted shape. The shell re-emits
# `shapes` after every move, so the newest event that is not older than the last `moved` event
# is current; the strip is not usable until the window has been placed (not parked).
function Get-PrimaryStripRect([int]$TimeoutMs = 5000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  do {
    $log = @(Read-SpikeLog | Where-Object { $_.PSObject.Properties['label'] -and $_.label -eq 'notch' })
    $moved = @($log | Where-Object { $_.event -eq 'moved' })
    $shapes = @($log | Where-Object { $_.event -eq 'shapes' })
    if ($moved.Count -gt 0 -and $shapes.Count -gt 0 -and -not $moved[-1].parked -and
        $shapes[-1].t_ms -ge $moved[-1].t_ms) {
      $rect = $shapes[-1].physical[0]
      return [pscustomobject]@{ X = [int]$rect.x; Y = [int]$rect.y; Width = [int]$rect.width; Height = [int]$rect.height }
    }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'The primary notch window has not published placed shapes yet.'
}

function Get-NotchWindows {
  $found = New-Object System.Collections.Generic.List[IntPtr]
  $callback = [MunaSpike.Native+EnumWindowsProc]{
    param($hwnd, $lParam)
    $name = New-Object System.Text.StringBuilder 256
    [void][MunaSpike.Native]::GetClassNameW($hwnd, $name, 256)
    if ($name.ToString() -eq 'MunaNotch') { $found.Add($hwnd) }
    $true
  }
  [void][MunaSpike.Native]::EnumWindows($callback, [IntPtr]::Zero)
  $found | ForEach-Object {
    $r = New-Object MunaSpike.Native+RECT
    [void][MunaSpike.Native]::GetWindowRect($_, [ref]$r)
    [pscustomobject]@{ Hwnd = $_; Left = $r.Left; Top = $r.Top; Right = $r.Right; Bottom = $r.Bottom
      ExStyle = [MunaSpike.Native]::GetWindowLongPtrW($_, -20).ToInt64() }
  }
}

function Test-IsNotchWindow([IntPtr]$Hwnd) {
  if ($Hwnd -eq [IntPtr]::Zero) { return $false }
  $root = [MunaSpike.Native]::GetAncestor($Hwnd, 2)
  $name = New-Object System.Text.StringBuilder 256
  [void][MunaSpike.Native]::GetClassNameW($root, $name, 256)
  $name.ToString() -eq 'MunaNotch'
}

function Get-WindowAtPoint([int]$X, [int]$Y) {
  $p = New-Object MunaSpike.Native+POINT
  $p.X = $X; $p.Y = $Y
  [MunaSpike.Native]::WindowFromPoint($p)
}

<# Visible top-level windows from top to bottom of the z-order. #>
function Get-ZOrder {
  $list = @()
  $hwnd = [MunaSpike.Native]::GetTopWindow([IntPtr]::Zero)
  $guard = 0
  while ($hwnd -ne [IntPtr]::Zero -and $guard -lt 2000) {
    if ([MunaSpike.Native]::IsWindowVisible($hwnd)) { $list += $hwnd }
    $hwnd = [MunaSpike.Native]::GetWindow($hwnd, 2)
    $guard++
  }
  $list
}

function Get-UserNotificationState {
  $state = 0
  [void][MunaSpike.Native]::SHQueryUserNotificationState([ref]$state)
  switch ($state) {
    1 { 'notPresent' } 2 { 'busy' } 3 { 'fullscreenD3d' } 4 { 'presentation' }
    5 { 'acceptsNotifications' } 6 { 'quietTime' } 7 { 'app' } default { "unknown($state)" }
  }
}

<# Captures a physical-pixel screen rectangle into a Bitmap (caller disposes). #>
function Capture-Region([int]$X, [int]$Y, [int]$Width, [int]$Height) {
  $bmp = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try { $g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size) } finally { $g.Dispose() }
  $bmp
}

<# Fast pixel dump of a 32bpp bitmap as a byte array (BGRA). #>
function Get-BitmapBytes([System.Drawing.Bitmap]$Bitmap) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $Bitmap.Width, $Bitmap.Height
  $data = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $Bitmap.PixelFormat)
  try {
    $bytes = New-Object byte[] ($data.Stride * $Bitmap.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    $bytes
  } finally { $Bitmap.UnlockBits($data) }
}

<# Fraction of pixels that are near-black (all channels < 16). #>
function Get-BlackFraction([byte[]]$Bgra) { [MunaSpike.Pixels]::BlackFraction($Bgra, 16) }

<# Fraction of pixels whose colour differs between two same-size BGRA buffers (any channel by > 24). #>
function Get-DiffFraction([byte[]]$A, [byte[]]$B) { [MunaSpike.Pixels]::DiffFraction($A, $B, 24) }

<#
  Records the strip region as fast as CopyFromScreen allows until `-Until` returns true, then
  classifies frames the way docs/spikes/m0-window.md W1 prescribes: a frame whose region
  differs from *both* neighbours by more than 2 % of pixels is a flash. Transition frames
  (equal to one neighbour) are normal. Flash frames are saved as PNGs next to the results.
#>
function Record-StripFlashes {
  param(
    [Parameter(Mandatory)]$Rect,
    [Parameter(Mandatory)][scriptblock]$Until,
    [string]$Name = 'flashes',
    [int]$MaxSeconds = 180
  )
  New-Item -ItemType Directory -Force -Path $script:ResultsDir | Out-Null
  $frames = New-Object System.Collections.Generic.List[object]
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $prevBytes = $null
  $prevBmp = $null
  $prevPrevBmp = $null
  $pendingSave = $null
  $captureErrors = 0
  $checkEvery = 30
  $i = 0
  while ($stopwatch.Elapsed.TotalSeconds -lt $MaxSeconds) {
    if (($i % $checkEvery) -eq 0 -and (& $Until)) { break }
    $i++
    try { $bmp = Capture-Region $Rect.X $Rect.Y $Rect.Width $Rect.Height } catch { $captureErrors++; Start-Sleep -Milliseconds 5; continue }
    $bytes = Get-BitmapBytes $bmp
    $diffPrev = if ($null -ne $prevBytes) { Get-DiffFraction $prevBytes $bytes } else { 0.0 }
    $frames.Add([pscustomobject]@{
        t = $stopwatch.Elapsed.TotalMilliseconds
        black = [MunaSpike.Pixels]::BlackFraction($bytes, 16)
        brightness = [MunaSpike.Pixels]::MeanBrightness($bytes)
        diffPrev = $diffPrev
        diffNext = 0.0
        flash = $false
      })
    $n = $frames.Count
    if ($n -ge 2) { $frames[$n - 2].diffNext = $diffPrev }
    if ($n -ge 3 -and $frames[$n - 2].diffPrev -gt 0.02 -and $frames[$n - 2].diffNext -gt 0.02) {
      $frames[$n - 2].flash = $true
      $idx = $n - 2
      if ($null -ne $prevPrevBmp) { $prevPrevBmp.Save((Join-Path $script:ResultsDir "$Name-flash$idx-before.png")) }
      if ($null -ne $prevBmp) { $prevBmp.Save((Join-Path $script:ResultsDir "$Name-flash$idx.png")) }
      $bmp.Save((Join-Path $script:ResultsDir "$Name-flash$idx-after.png"))
    }
    if ($null -ne $prevPrevBmp) { $prevPrevBmp.Dispose() }
    $prevPrevBmp = $prevBmp
    $prevBmp = $bmp
    $prevBytes = $bytes
  }
  if ($null -ne $prevPrevBmp) { $prevPrevBmp.Dispose() }
  if ($null -ne $prevBmp) { $prevBmp.Dispose() }
  $duration = $stopwatch.Elapsed.TotalSeconds
  [pscustomobject]@{
    frames = $frames.Count
    seconds = [math]::Round($duration, 1)
    captureHz = [math]::Round($frames.Count / [math]::Max($duration, 0.001), 1)
    captureErrors = $captureErrors
    transitions = @($frames | Where-Object { $_.diffPrev -gt 0.02 }).Count
    flashes = @($frames | Where-Object { $_.flash }).Count
    flashFrames = @($frames | Where-Object { $_.flash } | Select-Object t, black, brightness, diffPrev, diffNext)
    placedFrames = @($frames | Where-Object { $_.black -ge 0.7 }).Count
    otherFrames = @($frames | Where-Object { $_.black -lt 0.7 }).Count
    maxBrightness = [math]::Round((($frames | Measure-Object -Property brightness -Maximum).Maximum), 1)
  }
}

function Save-Result {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)]$Data)
  New-Item -ItemType Directory -Force -Path $script:ResultsDir | Out-Null
  $path = Join-Path $script:ResultsDir "$Name.json"
  $Data | ConvertTo-Json -Depth 8 | Set-Content -Path $path -Encoding UTF8
  Write-Host "wrote $path"
  if (Test-Path $script:SpikeLog) { Copy-Item $script:SpikeLog (Join-Path $script:ResultsDir "$Name.jsonl") -Force }
}

function Get-Median([double[]]$Values) {
  if ($Values.Count -eq 0) { return $null }
  $sorted = $Values | Sort-Object
  $mid = [int][math]::Floor($sorted.Count / 2)
  if ($sorted.Count % 2 -eq 1) { $sorted[$mid] } else { ($sorted[$mid - 1] + $sorted[$mid]) / 2 }
}

# Nearest-rank percentile (P in 0..100).
function Get-Percentile([double[]]$Values, [double]$P) {
  if ($Values.Count -eq 0) { return $null }
  $sorted = @($Values | Sort-Object)
  $rank = [int][math]::Ceiling($P / 100 * $sorted.Count)
  $sorted[[math]::Max(0, [math]::Min($sorted.Count - 1, $rank - 1))]
}

<# Colour of one screen pixel (physical coordinates) as an [R, G, B] array; ~0.1 ms per call. #>
function Get-ScreenPixel([int]$X, [int]$Y) {
  $hdc = [MunaSpike.Native]::GetDC([IntPtr]::Zero)
  try {
    $c = [MunaSpike.Native]::GetPixel($hdc, $X, $Y)
    @([int]($c -band 0xFF), [int](($c -shr 8) -band 0xFF), [int](($c -shr 16) -band 0xFF))
  } finally { [void][MunaSpike.Native]::ReleaseDC([IntPtr]::Zero, $hdc) }
}

function Test-NearBlack([int[]]$Rgb, [int]$Threshold = 16) {
  $Rgb[0] -lt $Threshold -and $Rgb[1] -lt $Threshold -and $Rgb[2] -lt $Threshold
}

<#
  A borderless WinForms window used as a stand-in for "another topmost window" (W12) or a
  fullscreen application (W11). Bounds are physical pixels (the harness is per-monitor-v2).
  Returns the form; call Close-OverlayForm when done.
#>
function New-OverlayForm {
  param(
    [Parameter(Mandatory)][int]$X, [Parameter(Mandatory)][int]$Y,
    [Parameter(Mandatory)][int]$Width, [Parameter(Mandatory)][int]$Height,
    [System.Drawing.Color]$Color = [System.Drawing.Color]::Red,
    [switch]$TopMost
  )
  Add-Type -AssemblyName System.Windows.Forms
  $form = New-Object System.Windows.Forms.Form
  $form.FormBorderStyle = 'None'
  $form.StartPosition = 'Manual'
  $form.ShowInTaskbar = $false
  $form.BackColor = $Color
  $form.TopMost = [bool]$TopMost
  $form.Text = 'Muna spike overlay'
  $form.Bounds = New-Object System.Drawing.Rectangle $X, $Y, $Width, $Height
  $form
}

<# Shows the form without activating it (SW_SHOWNA) so the z-order change is the only event. #>
function Show-OverlayForm([System.Windows.Forms.Form]$Form) {
  [void]$Form.Handle
  [void][MunaSpike.Native]::ShowWindow($Form.Handle, 8)
  [void][MunaSpike.Native]::SetWindowPos($Form.Handle, [IntPtr]::Zero, $Form.Left, $Form.Top, $Form.Width, $Form.Height, 0x0010 -bor 0x0004 -bor 0x0040)
  [System.Windows.Forms.Application]::DoEvents()
}

<#
  Foreground activation from a background process is refused unless the process received the
  last input, so a no-op Alt press is injected first (the usual workaround). Returns whether
  GetForegroundWindow reports the window afterwards.
#>
function Set-ForegroundWindowForce([IntPtr]$Hwnd) {
  [MunaSpike.Native]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [MunaSpike.Native]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][MunaSpike.Native]::SetForegroundWindow($Hwnd)
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 30
  [MunaSpike.Native]::GetForegroundWindow() -eq $Hwnd
}

function Close-OverlayForm([System.Windows.Forms.Form]$Form) {
  if ($null -ne $Form -and -not $Form.IsDisposed) {
    $Form.Close()
    $Form.Dispose()
    [System.Windows.Forms.Application]::DoEvents()
  }
}

<# Monitors as the spike last enumerated them (bounds in physical pixels, scale factor). #>
function Get-SpikeMonitors {
  $events = @(Read-SpikeLog | Where-Object { $_.event -eq 'monitors' })
  if ($events.Count -eq 0) { return @() }
  @($events[-1].monitors)
}
