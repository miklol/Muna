<#
.SYNOPSIS
  Runs the Muna desktop app in development mode.
.DESCRIPTION
  Sets WEBVIEW2_DEFAULT_BACKGROUND_COLOR to fully transparent so the notch window never flashes
  white before the first paint, then starts `tauri dev` (Vite on :1420 + cargo run).
  Extra arguments are forwarded to the Tauri CLI, e.g. `.\scripts\dev.ps1 --release`.
.PARAMETER HitTest
  Draws the notch shell's hit-test rects and the last morph's frame rate over the notch window
  (sets VITE_MUNA_HIT_TEST=1; dev builds only).
.PARAMETER FullMotion
  Runs the springs even when Windows has animation effects off, so morph frame rates can be
  measured (sets VITE_MUNA_FULL_MOTION=1; dev builds only).
#>
[CmdletBinding()]
param(
  [switch]$HitTest,
  [switch]$FullMotion,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error 'pnpm is not installed. Run `corepack enable` (Node 22 ships corepack) or `npm i -g pnpm@10`.'
}

$env:WEBVIEW2_DEFAULT_BACKGROUND_COLOR = '00000000'
$env:RUST_BACKTRACE = if ($env:RUST_BACKTRACE) { $env:RUST_BACKTRACE } else { '1' }
if ($HitTest) {
  $env:VITE_MUNA_HIT_TEST = '1'
  Write-Host 'Hit-test overlay on (VITE_MUNA_HIT_TEST=1).'
}
if ($FullMotion) {
  $env:VITE_MUNA_FULL_MOTION = '1'
  Write-Host 'Ignoring the OS reduced-motion preference (VITE_MUNA_FULL_MOTION=1).'
}

Write-Host 'Starting Muna (tauri dev) with a transparent WebView2 background…'
& pnpm --filter @muna/desktop tauri dev @TauriArgs
exit $LASTEXITCODE
