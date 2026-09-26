<#
.SYNOPSIS
  OLE drag source for docs/spikes/m4-drop.md: drags one file from a scripted mouse press.
.DESCRIPTION
  Windows PowerShell 5.1 (STA, WinForms). OLE ends a drag at once when no mouse button is down
  when DoDragDrop is called (it never asks the source), so this script shows a 40 x 40 nearly
  transparent top-most form at -StartX/-StartY, moves the cursor onto it and presses the left
  button with mouse_event; the form's MouseDown handler then calls DoDragDrop with a FileDrop
  data object. QueryContinueDrag keeps the drag alive until -HoldMs have passed, then answers
  Cancel or Drop (-Mode); the button is released when DoDragDrop returns. The cursor is moved
  by someone else in the meantime (scripts/perf/probe.ps1). One JSON line per phase on stdout:
  ready, started, ended (final effect, elapsed ms, number of QueryContinueDrag calls) or error.
  Nothing here is part of the shipped app.
#>
param(
  [Parameter(Mandatory = $true)] [string] $Path,
  [Parameter(Mandatory = $true)] [int] $StartX,
  [Parameter(Mandatory = $true)] [int] $StartY,
  [int] $HoldMs = 1500,
  [ValidateSet('cancel', 'drop')] [string] $Mode = 'cancel'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Phase([hashtable] $Fields) {
  $Fields['atUtc'] = [DateTime]::UtcNow.ToString('o')
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject ([pscustomobject]$Fields) -Compress))
  [Console]::Out.Flush()
}

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
  Write-Phase @{ phase = 'error'; message = 'DoDragDrop needs an STA thread; run with powershell.exe -Sta' }
  exit 2
}
if (-not (Test-Path -LiteralPath $Path)) {
  Write-Phase @{ phase = 'error'; message = 'file to drag does not exist' }
  exit 2
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace MunaDropSpike -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
'@
# Per-monitor-v2 so StartX/StartY are physical pixels like the probe's.
[void][MunaDropSpike.Native]::SetProcessDpiAwarenessContext([IntPtr](-4))
$LEFTDOWN = [uint32]0x0002
$LEFTUP = [uint32]0x0004

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.Size = New-Object System.Drawing.Size(40, 40)
$form.Location = New-Object System.Drawing.Point(($StartX - 20), ($StartY - 20))
$form.BackColor = [System.Drawing.Color]::Black
# Alpha-layered windows still hit-test; only colour-keyed ones let the click through.
$form.Opacity = 0.05

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$state = @{ queries = 0; decided = $false; started = $false; buttonDown = $false }
$holdMs = $HoldMs
$mode = $Mode
$data = New-Object System.Windows.Forms.DataObject
$data.SetData([System.Windows.Forms.DataFormats]::FileDrop, [string[]]@((Resolve-Path -LiteralPath $Path).Path))

$form.add_QueryContinueDrag({
    param($sender, $e)
    $state.queries += 1
    if ($e.EscapePressed) {
      $state.decided = $true
      $e.Action = [System.Windows.Forms.DragAction]::Cancel
      return
    }
    if ($stopwatch.ElapsedMilliseconds -lt $holdMs) {
      $e.Action = [System.Windows.Forms.DragAction]::Continue
      return
    }
    $state.decided = $true
    $e.Action = if ($mode -eq 'drop') {
      [System.Windows.Forms.DragAction]::Drop
    } else {
      [System.Windows.Forms.DragAction]::Cancel
    }
  })

$form.add_MouseDown({
    param($sender, $e)
    if ($state.started) { return }
    $state.started = $true
    Write-Phase @{ phase = 'started' }
    $stopwatch.Restart()
    try {
      $effect = $form.DoDragDrop($data, [System.Windows.Forms.DragDropEffects]::Copy)
      Write-Phase @{
        phase = 'ended'
        effect = $effect.ToString()
        elapsedMs = $stopwatch.ElapsedMilliseconds
        queries = $state.queries
        decided = $state.decided
      }
    } catch {
      Write-Phase @{ phase = 'error'; message = $_.Exception.Message }
    } finally {
      if ($state.buttonDown) {
        [MunaDropSpike.Native]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
        $state.buttonDown = $false
      }
      $form.Close()
    }
  })

# Press once the form is up and the cursor is on it; give up if the press never arrives.
$press = New-Object System.Windows.Forms.Timer
$press.Interval = 250
$press.add_Tick({
    $press.Stop()
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($StartX, $StartY)
    Write-Phase @{ phase = 'ready'; pid = $PID; mode = $mode; holdMs = $holdMs; startX = $StartX; startY = $StartY }
    $state.buttonDown = $true
    [MunaDropSpike.Native]::mouse_event($LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  })
$watchdog = New-Object System.Windows.Forms.Timer
$watchdog.Interval = 4000
$watchdog.add_Tick({
    $watchdog.Stop()
    if (-not $state.started) {
      Write-Phase @{ phase = 'error'; message = 'the press never reached the form' }
      if ($state.buttonDown) { [MunaDropSpike.Native]::mouse_event($LEFTUP, 0, 0, 0, [UIntPtr]::Zero) }
      $form.Close()
    }
  })
$form.add_Shown({ $press.Start(); $watchdog.Start() })

try {
  [System.Windows.Forms.Application]::Run($form)
} finally {
  $press.Dispose()
  $watchdog.Dispose()
  $form.Dispose()
}
