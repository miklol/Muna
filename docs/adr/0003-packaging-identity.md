# ADR-0003 · Packaging & identity: MSIX primary, NSIS portable

**Status:** Accepted (pending M0-E3 spike validation, plan in
[spikes/m0-identity](../spikes/m0-identity.md)) · **Date:** 2026-09-14

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

## Consequences

- Two artifacts to test in CI (install matrix). MSIX runs from a read-only install location →
  all writable state under `%APPDATA%`/`%LOCALAPPDATA%`.
- Autostart differs: `StartupTask` (packaged) vs `HKCU\…\Run` (unpackaged) — abstracted behind
  an autostart trait in `muna-platform`.
- Microsoft Store listing becomes possible later with the same MSIX.
