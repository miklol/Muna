# Spike M0-E3 · Package identity & signing

**Status:** Planned · **Validates:** [ADR-0003](../adr/0003-packaging-identity.md) ·
**Owner:** `muna-release-engineer` · **Plan:** `muna-architect`, 2026-09-14

Kickoff prompt:
[build-plan/m0-foundations.md](../build-plan/m0-foundations.md#m0-e3--identity--packaging-spike--agent-muna-release-engineer).

## Question

Do the identity-dependent APIs (notification listener with change events, `StartupTask`,
appointments) work under (a) a signed MSIX and (b) an NSIS install registered as a package
with external location, and does the release pipeline produce both artefacts unsigned?

## How to run

- `pnpm -w msix:build` (E3 replaces the stub): `MakeAppx pack /nv` + `signtool` with a
  self-signed test certificate the script creates under `%TEMP%`; nothing is committed.
- `scripts/identity/`: external-location manifest and the PowerShell post-install snippet
  (with rollback) for the NSIS hook.
- `cargo run -p muna-probe` (`apps/desktop/src-tauri/crates/muna-probe`): one line per probe
  below; run it unpackaged, under external-location identity and inside the MSIX.
- Install only for the test and remove afterwards (`Remove-AppxPackage`); note anything left
  behind.

## Environment

| Item | Value |
| ------ | ------- |
| Machine / OS build | |
| Windows SDK (`MakeAppx`, `signtool`) version | |
| Test certificate subject (must equal the manifest `Publisher`) | |
| Commit | |

## Exit criteria

| # | Probe / step | Expected | Unpackaged | External location | MSIX | Pass |
| --- | -------------- | ---------- | ------------ | ------------------- | ------ | ------ |
| I1 | `GetCurrentPackageFullName` | `APPMODEL_ERROR_NO_PACKAGE` unpackaged; full name with identity | | | | |
| I2 | `UserNotificationListener.RequestAccessAsync` | `Allowed` with identity after consent | | | | |
| I3 | `GetNotificationsAsync` count | ≥ 1 after a test toast | | | | |
| I4 | `NotificationChanged` fires within 10 s of a test toast | yes with identity; documented "no" unpackaged → 1 s polling fallback | | | | |
| I5 | `StartupTask.GetAsync` | available with identity; state toggles Enabled ↔ Disabled | | | | |
| I6 | `AppointmentManager.RequestStoreAsync` | granted with `appointmentsSystem` (opportunistic) | | | | |
| I7 | MSIX installs, launches and uninstalls cleanly with the test cert trusted | yes | — | — | | |
| I8 | `Add-AppxPackage -ExternalLocation` registers; rollback snippet removes it | yes | — | | — | |
| I9 | `release.yml` dry run (`workflow_dispatch`, `dry_run=true`) | unsigned NSIS + MSIX artefacts uploaded (run URL) | | | | |
| I10 | `msix:build`, `release:appinstaller`, `release:updater`, `release:verify`, `sbom` | implemented against [11 › root scripts](../11-ci-cd.md#root-scripts-the-workflows-call); exit 0 locally | | | | |
| I11 | Code-signing eligibility | Azure Artifact Signing (Basic) or SignPath Foundation: eligible? cost per month | | | | |

## Observations

- Virtualisation surprises under MSIX (`%APPDATA%` redirection, COM such as `IPolicyConfig`).
- Anything that needs the unpackaged helper process named in ADR-0003.

## Maintainer checklist (delivered by this spike)

Environment, secrets, variables and rulesets to create, per
[11 › protection rules](../11-ci-cd.md#protection-rules) and
[11 › secrets and environments](../11-ci-cd.md#secrets-and-environments). Write it here and
link it from the PR; the maintainer ticks the roadmap's "rulesets, `release` environment and
Dependabot" exit criterion from it.

## Recommendation

<!-- ADR-0003 validated / amended because … -->
