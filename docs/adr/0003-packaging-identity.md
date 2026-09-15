# ADR-0003 · Packaging & identity: MSIX primary, NSIS portable

**Status:** Accepted (validated with amendments by the M0-E3 spike, 2026-09-15 — results in
[spikes/m0-identity](../spikes/m0-identity.md)) · **Date:** 2026-09-14 · **Amended:** 2026-09-15

## Context

`UserNotificationListener` (Notifications module), `AppointmentManager`, `StartupTask` and
some WinRT APIs require **package identity**. Unpackaged Tauri apps (NSIS/MSI) have none.
Sparse packages (external-location MSIX) can grant identity to an unpackaged app but still
require a trusted signature.

## Decision

- Ship **two installers**: a signed **MSIX** (package identity → full module set; auto-update
  via App Installer/Store-style) and a signed **NSIS** setup (Tauri updater). The NSIS build
  registers a **"package with external location"** identity manifest
  (`uap10:AllowExternalContent`, `runFullTrust`, `unvirtualizedResources`, installed with
  `Add-AppxPackage -ExternalLocation`) so `NotificationChanged` and `StartupTask` work there
  too; when that step fails (unsigned dev build, policy) the Notifications module falls back to
  1 s polling of `GetNotificationsAsync`, which works without identity.
- Build the MSIX in CI with `MakeAppx pack` + `signtool` (Tauri has no MSIX bundler, tauri
  #4818). Manifest capabilities: `runFullTrust`, `unvirtualizedResources`,
  `userNotificationListener`, `globalMediaControl`, `bluetooth`, `radios`, `webcam`,
  `microphone`, `location`, `appointmentsSystem` (opportunistic), plus the
  `windows.startupTask` extension. Seelen-UI's `AppxManifest.xml` is the reference template
  (AGPL — study, don't copy).
- Code signing: **Azure Artifact Signing** (formerly Trusted Signing, Basic tier) or
  **SignPath Foundation** (free for OSS) for both artifacts; the MSIX `Publisher` must equal
  the certificate subject.
- Detect identity at runtime (`GetCurrentPackageFullName` → `APPMODEL_ERROR_NO_PACKAGE`) to
  feature-flag identity-dependent modules.
- Undocumented COM such as `IPolicyConfig` (default audio device switching) misbehaves under
  MSIX virtualisation → invoked through a tiny unpackaged helper process.

## Amendments (M0-E3 spike, 2026-09-15)

Measured on Windows 11 25H2 with the probe in `crates/muna-probe`, unpackaged, under
external-location identity and inside the MSIX ([spikes/m0-identity](../spikes/m0-identity.md)):

- **The identity flag gates only `NotificationChanged` and `StartupTask`.** `RequestAccessAsync`
  returns `Allowed`, `GetNotificationsAsync` works and `AppointmentManager.RequestStoreAsync`
  is granted *without* identity; unpackaged, subscribing to `NotificationChanged` fails with
  `0x80070490` and `StartupTask.GetAsync` fails the same way. The Notifications module must
  probe the subscription itself (not `RequestAccessAsync`) and fall back to 1 s polling on that
  error; with identity the event fired 8–10 ms after a foreign toast on both routes.
- **Sideload trust is machine-wide.** `Add-AppxPackage` (full or `-ExternalLocation`) rejects a
  package whose certificate is trusted only per user (`0x800B0109`); the trust store that
  counts needs elevation. Consequences: release artefacts must carry a publicly trusted
  signature before the first beta (the code-signing decision in the spike's I11 gates M5),
  the NSIS external-location step fails soft on unsigned builds (`scripts/identity/
  register-external-location.ps1` — rollback, exit 0), and local installs use Developer-Mode
  `Add-AppxPackage -Register` of the loose layout (`msix:build --keep-stage`).
- **Scripts:** `scripts/msix/build.mjs` renders both manifests from `scripts/msix/identity.json`
  (`Publisher` must equal the certificate `Subject`); `release:verify` re-implements minisign
  verification in Node because the Tauri CLI has no `signer verify`; the version plumbing is
  `scripts/version.mjs`.
- Not exercised yet: the unpackaged `IPolicyConfig` helper (M2-E3 HUD) and virtualisation under
  a *signed* install (the loose-layout runs wrote to the real `%LOCALAPPDATA%\Muna`; re-check on
  the first signed beta).

## Consequences

- Two artifacts to test in CI (install matrix). MSIX runs from a read-only install location →
  all writable state under `%APPDATA%`/`%LOCALAPPDATA%`.
- Autostart differs: `StartupTask` (packaged) vs `HKCU\…\Run` (unpackaged) — abstracted behind
  an autostart trait in `muna-platform`.
- Microsoft Store listing becomes possible later with the same MSIX.
