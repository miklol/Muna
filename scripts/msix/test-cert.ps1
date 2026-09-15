<#
.SYNOPSIS
Creates (or reuses) an ephemeral self-signed code-signing certificate so a locally built MSIX
can be installed for testing (docs/spikes/m0-identity.md). Nothing here is committed or
uploaded: the key lives in the current user's certificate store, the public .cer in %TEMP%.

.DESCRIPTION
The certificate Subject must equal the manifest Publisher exactly, so the default is
`testPublisher` from scripts/msix/identity.json. The public .cer is exported to %TEMP% and
imported into Cert:\CurrentUser\TrustedPeople so `Get-AuthenticodeSignature` chains locally.

Measured on Windows 11 25H2 (docs/spikes/m0-identity.md, I7): `Add-AppxPackage` only accepts a
package whose chain ends in a *machine-wide* trusted certificate, so a per-user store is not
enough (0x800B0109). Two ways to install a locally built package:

1. Without elevation (recommended): register the loose layout in Developer Mode —
   `pnpm -w msix:build -- --keep-stage …` then
   `Add-AppxPackage -Register dist\local\.msix-stage\full\AppxManifest.xml`.
2. With elevation: `Import-Certificate -FilePath <cerPath> -CertStoreLocation
   Cert:\LocalMachine\TrustedPeople`, then `Add-AppxPackage -Path <msix>`.

Prints one JSON object (thumbprint, subject, notAfter, cerPath) for scripts/msix/build.mjs.

.PARAMETER Subject
X.500 subject of the certificate. Default: identity.json `testPublisher`.

.PARAMETER Remove
Deletes the test certificate(s) with that subject from CurrentUser\My, CurrentUser\TrustedPeople
(and LocalMachine\TrustedPeople when running elevated) and the exported .cer. Run this after the
install test.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/msix/test-cert.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/msix/test-cert.ps1 -Remove
#>
[CmdletBinding()]
param(
    [string]$Subject,
    [switch]$Remove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$codeSigningEku = '1.3.6.1.5.5.7.3.3'
$exportDir = Join-Path $env:TEMP 'muna-msix-test'

if (-not $Subject) {
    $identity = Get-Content (Join-Path $PSScriptRoot 'identity.json') -Raw | ConvertFrom-Json
    $Subject = $identity.testPublisher
}

function Get-TestCertificates([string]$store) {
    @(Get-ChildItem $store | Where-Object {
        $_.Subject -eq $Subject -and ($_.EnhancedKeyUsageList | ForEach-Object { $_.ObjectId }) -contains $codeSigningEku
    })
}

if ($Remove) {
    $removed = 0
    $stores = @('Cert:\CurrentUser\My', 'Cert:\CurrentUser\TrustedPeople')
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $stores += 'Cert:\LocalMachine\TrustedPeople'
    }
    foreach ($store in $stores) {
        foreach ($cert in Get-TestCertificates $store) {
            Remove-Item -Path (Join-Path $store $cert.Thumbprint) -Force
            $removed++
        }
    }
    if (Test-Path $exportDir) { Remove-Item $exportDir -Recurse -Force }
    Write-Output (@{ removed = $removed; subject = $Subject } | ConvertTo-Json -Compress)
    exit 0
}

$existing = @(Get-TestCertificates 'Cert:\CurrentUser\My' | Where-Object { $_.NotAfter -gt (Get-Date).AddDays(1) })
if ($existing.Count -gt 0) {
    $cert = $existing[0]
} else {
    # Basic constraints "{text}" (empty) marks it an end-entity certificate, which AppX signing
    # requires; the EKU is code signing only.
    $cert = New-SelfSignedCertificate `
        -Type Custom `
        -Subject $Subject `
        -KeyUsage DigitalSignature `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -NotAfter (Get-Date).AddDays(30) `
        -FriendlyName 'Muna MSIX test signing (ephemeral, safe to delete)' `
        -TextExtension @("2.5.29.37={text}$codeSigningEku", '2.5.29.19={text}')
}

New-Item -ItemType Directory -Force -Path $exportDir | Out-Null
$cerPath = Join-Path $exportDir "$($cert.Thumbprint).cer"
if (-not (Test-Path $cerPath)) {
    Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
}

$trusted = @(Get-ChildItem 'Cert:\CurrentUser\TrustedPeople' | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })
if ($trusted.Count -eq 0) {
    Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\TrustedPeople' | Out-Null
}

Write-Output (@{
    thumbprint = $cert.Thumbprint
    subject    = $cert.Subject
    notAfter   = $cert.NotAfter.ToString('o')
    cerPath    = $cerPath
} | ConvertTo-Json -Compress)
