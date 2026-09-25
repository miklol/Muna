<#
.SYNOPSIS
  Measures now-playing latency on real hardware (docs/07-roadmap.md, M2 exit criteria).
.DESCRIPTION
  Presses the keyboard's media keys (play/pause, next) at a recorded wall-clock time and reads
  the `unix_ms` the media module stamps on its "now playing changed" log line, so the number is
  key press → strip activity published, end to end through the OS's media session manager.

  Run the app first (`scripts\dev.ps1`) with a media app that has a session (Spotify, Media
  Player, Edge). The script toggles playback: expect a few seconds of audio.
.PARAMETER Toggles
  How many play/pause presses to time (default 6, so playback ends where it started).
.PARAMETER Skips
  How many next-track presses to time after the toggles (default 2). Each is timed twice:
  the track change and the artwork that follows it.
.PARAMETER Log
  The app log to watch (default `%LOCALAPPDATA%\Muna\logs\muna.log`).
#>
[CmdletBinding()]
param(
  [int]$Toggles = 6,
  [int]$Skips = 2,
  [string]$Log = (Join-Path $env:LOCALAPPDATA 'Muna\logs\muna.log')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Log)) { Write-Error "no log at $Log; start the app first" }

Add-Type -Namespace MunaQa -Name Keys -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@

$VK_MEDIA_NEXT_TRACK = 0xB0
$VK_MEDIA_PLAY_PAUSE = 0xB3
$KEYEVENTF_KEYUP = 0x0002

function Send-MediaKey([byte]$vk) {
  [MunaQa.Keys]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
  [MunaQa.Keys]::keybd_event($vk, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
}

function Get-UnixMs { [long][Math]::Floor(([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()) }

function Get-ChangeCount { @(Select-String -Path $Log -Pattern 'now playing changed' -SimpleMatch).Count }

# Waits for `count` new "now playing changed" lines and returns their stamps and details.
function Wait-Changes([int]$before, [int]$count, [int]$timeoutMs = 5000) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  do {
    $lines = @(Select-String -Path $Log -Pattern 'now playing changed' -SimpleMatch)
    if ($lines.Count -ge $before + $count) {
      return $lines[$before..($before + $count - 1)] | ForEach-Object {
        $line = $_.Line
        [pscustomobject]@{
          UnixMs = [long]([regex]::Match($line, 'unix_ms=(\d+)').Groups[1].Value)
          App = [regex]::Match($line, 'app=(\S+)').Groups[1].Value
          Status = [regex]::Match($line, 'status=(\S+)').Groups[1].Value
          ArtVersion = [regex]::Match($line, 'art_version=(\d+)').Groups[1].Value
        }
      }
    }
    Start-Sleep -Milliseconds 20
  } while ((Get-Date) -lt $deadline)
  return @()
}

$results = New-Object System.Collections.Generic.List[object]

for ($i = 1; $i -le $Toggles; $i++) {
  $before = Get-ChangeCount
  $t0 = Get-UnixMs
  Send-MediaKey $VK_MEDIA_PLAY_PAUSE
  $changes = Wait-Changes $before 1
  if ($changes.Count -eq 0) {
    $results.Add([pscustomobject]@{ Step = "play/pause $i"; App = '-'; Status = 'no change within 5 s'; LatencyMs = $null })
  } else {
    $c = $changes[0]
    $results.Add([pscustomobject]@{ Step = "play/pause $i"; App = $c.App; Status = $c.Status; LatencyMs = $c.UnixMs - $t0 })
  }
  Start-Sleep -Milliseconds 2500
}

for ($i = 1; $i -le $Skips; $i++) {
  $before = Get-ChangeCount
  $t0 = Get-UnixMs
  Send-MediaKey $VK_MEDIA_NEXT_TRACK
  # First line: the track change (title/artist). Second: the artwork for it.
  $changes = Wait-Changes $before 2 8000
  if ($changes.Count -lt 1) {
    $results.Add([pscustomobject]@{ Step = "next $i"; App = '-'; Status = 'no change within 8 s'; LatencyMs = $null })
  } else {
    $c = $changes[0]
    $results.Add([pscustomobject]@{ Step = "next $i (track)"; App = $c.App; Status = $c.Status; LatencyMs = $c.UnixMs - $t0 })
    if ($changes.Count -ge 2) {
      $a = $changes[1]
      $results.Add([pscustomobject]@{ Step = "next $i (art v$($a.ArtVersion))"; App = $a.App; Status = $a.Status; LatencyMs = $a.UnixMs - $t0 })
    } else {
      $results.Add([pscustomobject]@{ Step = "next $i (art)"; App = $c.App; Status = 'no art within 8 s'; LatencyMs = $null })
    }
  }
  Start-Sleep -Milliseconds 3000
}

$budgetMs = 300  # docs/07-roadmap.md, M2 exit criteria

function Verdict($row) {
  if ($null -eq $row.LatencyMs) { return 'FAIL' }
  if ($row.Step -like '*(art*') { return 'SKIP' }  # no budget for late-delivered art; recorded
  if ($row.LatencyMs -lt $budgetMs) { return 'PASS' } else { return 'FAIL' }
}

$results | ForEach-Object { $_ | Add-Member -NotePropertyName Result -NotePropertyValue (Verdict $_) -PassThru } |
  Format-Table -Property Result, Step, App, Status, LatencyMs -AutoSize

$timed = @($results | Where-Object { $null -ne $_.LatencyMs -and $_.Step -like 'play/pause*' } | ForEach-Object { $_.LatencyMs } | Sort-Object)
if ($timed.Count -gt 0) {
  $median = $timed[[int][Math]::Floor(($timed.Count - 1) / 2)]
  Write-Output ("play/pause -> strip: median {0} ms, max {1} ms over {2} presses (budget {3} ms)" -f $median, $timed[-1], $timed.Count, $budgetMs)
}
