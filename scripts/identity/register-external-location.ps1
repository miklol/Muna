<#
.SYNOPSIS
Gives an NSIS (unpackaged) Muna install package identity by registering the external-location
package next to it, or removes that registration again (ADR-0003, docs/10-release-distribution.md).

.DESCRIPTION
Registers `Muna_<ver>_x64-external.msix` (built by scripts/msix/build.mjs from
scripts/identity/external-location.manifest.xml) with `Add-AppxPackage -ExternalLocation`, pointing
the package at the directory that contains muna.exe. With identity, `NotificationChanged` and
`StartupTask` work exactly as in the full MSIX (docs/spikes/m0-identity.md, I8).

The script fails soft by design: the installer must succeed even when identity cannot be
registered (unsigned dev build, machine policy, missing Developer Mode). Any failure is reported
as JSON on stdout, a partially registered package is removed again (rollback), and the exit code
is 0 unless -Strict is given. Muna then runs unpackaged and uses its 1 s polling fallback.

Existing registrations of the same package family are handled like this:
- an older external-location registration is replaced (upgrade path);
- a full MSIX install is left alone and reported as `skipped` — the MSIX already has identity and
  removing it would delete the user's app.

When run from PowerShell 7 the script re-executes itself in Windows PowerShell 5.1, where the Appx
module is native (the implicit-remoting shim in PowerShell 7 deserialises package objects).

.PARAMETER Package
Path to the signed external-location .msix. A path ending in AppxManifest.xml is registered as a
loose layout instead (`Add-AppxPackage -Register`), which needs Developer Mode but no signature —
the route used for local testing.

.PARAMETER InstallDir
Directory that contains muna.exe (the external location). Default: the directory of this script's
parent, which matches the NSIS layout `$INSTDIR\identity\register-external-location.ps1`.

.PARAMETER Remove
Remove the external-location registration instead of adding it.

.PARAMETER PackageName
Package identity name to look for. Default `miklol.Muna` (scripts/msix/identity.json).

.PARAMETER Strict
Exit 1 on failure instead of 0. Used by tests and CI, never by the installer.

.EXAMPLE
# Local test without signing (Developer Mode):
pnpm -w msix:build -- --version 0.0.0 --out dist/local --keep-stage
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/identity/register-external-location.ps1 `
  -Package dist\local\.msix-stage\external\AppxManifest.xml `
  -InstallDir apps\desktop\src-tauri\target\release -Strict
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/identity/register-external-location.ps1 -Remove

.EXAMPLE
# NSIS hook (apps/desktop/src-tauri/nsis/hooks.nsi, wired in M5 via bundle.windows.nsis.installerHooks):
#   !macro NSIS_HOOK_POSTINSTALL
#     nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\identity\register-external-location.ps1" -Package "$INSTDIR\identity\Muna-external.msix" -InstallDir "$INSTDIR"'
#   !macroend
#   !macro NSIS_HOOK_PREUNINSTALL
#     nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\identity\register-external-location.ps1" -Remove'
#   !macroend
#>
[CmdletBinding(DefaultParameterSetName = 'Add')]
param(
    [Parameter(ParameterSetName = 'Add', Mandatory = $true)]
    [string]$Package,

    [Parameter(ParameterSetName = 'Add')]
    [string]$InstallDir,

    [Parameter(ParameterSetName = 'Remove', Mandatory = $true)]
    [switch]$Remove,

    [string]$PackageName = 'miklol.Muna',

    [switch]$Strict
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -eq 'Core') {
    # Re-run under Windows PowerShell with its own module path; a PowerShell 7 PSModulePath makes
    # 5.1 load the wrong Security/Appx modules.
    $forwarded = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    foreach ($entry in $PSBoundParameters.GetEnumerator()) {
        if ($entry.Value -is [switch]) {
            if ($entry.Value.IsPresent) { $forwarded += "-$($entry.Key)" }
        } else {
            $forwarded += "-$($entry.Key)", "$($entry.Value)"
        }
    }
    $env:PSModulePath = @(
        (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'WindowsPowerShell\Modules'),
        (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
        (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules')
    ) -join ';'
    & (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') @forwarded
    exit $LASTEXITCODE
}

function Write-Result([hashtable]$result) {
    Write-Output ($result | ConvertTo-Json -Compress)
}

function Exit-Failure([string]$step, [string]$message, [hashtable]$extra = @{}) {
    $result = @{ status = 'failed'; step = $step; error = $message } + $extra
    Write-Result $result
    exit ($(if ($Strict) { 1 } else { 0 }))
}

function Test-ExternalLocationPackage($appxPackage) {
    try {
        $manifest = Get-AppxPackageManifest -Package $appxPackage.PackageFullName
        return "$($manifest.Package.Properties.AllowExternalContent)" -eq 'true'
    } catch {
        return $false
    }
}

function Get-FamilyPackages {
    @(Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue)
}

function Remove-ExternalLocationPackages([string]$step) {
    $removed = @()
    foreach ($existing in Get-FamilyPackages) {
        if (Test-ExternalLocationPackage $existing) {
            Remove-AppxPackage -Package $existing.PackageFullName
            $removed += $existing.PackageFullName
        }
    }
    # The comma keeps the array intact through the pipeline (no unrolling to $null / scalar).
    return ,$removed
}

if ($Remove) {
    try {
        $removed = Remove-ExternalLocationPackages 'remove'
        $kept = @(Get-FamilyPackages | ForEach-Object { $_.PackageFullName })
        Write-Result @{ status = 'removed'; removed = @($removed); kept = $kept }
        exit 0
    } catch {
        Exit-Failure 'remove' $_.Exception.Message
    }
}

if (-not $InstallDir) {
    $InstallDir = Split-Path -Parent $PSScriptRoot
}

try {
    $packagePath = (Resolve-Path $Package).Path
    $installPath = (Resolve-Path $InstallDir).Path
} catch {
    Exit-Failure 'resolve' $_.Exception.Message
}
if (-not (Test-Path (Join-Path $installPath 'muna.exe'))) {
    Exit-Failure 'resolve' "muna.exe not found in $installPath"
}

$fullPackages = @(Get-FamilyPackages | Where-Object { -not (Test-ExternalLocationPackage $_) })
if ($fullPackages.Count -gt 0) {
    Write-Result @{
        status = 'skipped'
        reason = 'full MSIX package is installed'
        packages = @($fullPackages | ForEach-Object { $_.PackageFullName })
    }
    exit 0
}

try {
    $replaced = Remove-ExternalLocationPackages 'replace'
} catch {
    Exit-Failure 'replace' $_.Exception.Message
}

$looseLayout = [IO.Path]::GetFileName($packagePath) -ieq 'AppxManifest.xml'
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
try {
    if ($looseLayout) {
        Add-AppxPackage -Register $packagePath -ExternalLocation $installPath
    } else {
        Add-AppxPackage -Path $packagePath -ExternalLocation $installPath
    }
} catch {
    $message = $_.Exception.Message
    $rolledBack = @()
    try { $rolledBack = Remove-ExternalLocationPackages 'rollback' } catch { }
    Exit-Failure 'register' $message @{ rolledBack = @($rolledBack); replaced = @($replaced); elapsedMs = $stopwatch.ElapsedMilliseconds }
}

$registered = @(Get-FamilyPackages | Where-Object { Test-ExternalLocationPackage $_ })
if ($registered.Count -eq 0) {
    Exit-Failure 'verify' 'Add-AppxPackage returned but no external-location package is registered'
}

Write-Result @{
    status            = 'registered'
    mode              = $(if ($looseLayout) { 'developer-mode' } else { 'signed' })
    packageFullName   = $registered[0].PackageFullName
    packageFamilyName = $registered[0].PackageFamilyName
    externalLocation  = $installPath
    replaced          = @($replaced)
    elapsedMs         = $stopwatch.ElapsedMilliseconds
}
exit 0
