# Spike M0-E3 · Package identity & signing

**Status:** Recorded (Win11 25H2; I9 dry run and I11 signing decision open for the maintainer)
· **Validates:** [ADR-0003](../adr/0003-packaging-identity.md) ·
**Owner:** `muna-release-engineer` · **Plan:** `muna-architect`, 2026-09-14 ·
**Measured:** `muna-architect`, 2026-09-15

Kickoff prompt:
[build-plan/m0-foundations.md](../build-plan/m0-foundations.md#m0-e3--identity--packaging-spike--agent-muna-release-engineer).

## Question

Do the identity-dependent APIs (notification listener with change events, `StartupTask`,
appointments) work under (a) a signed MSIX and (b) an NSIS install registered as a package
with external location, and does the release pipeline produce both artefacts unsigned?

**Answer: yes, on both identity routes, and the pipeline scripts produce both artefacts.**
With package identity — full MSIX or the external-location package registered next to the
unpackaged `muna.exe` — `NotificationChanged` fires 8–10 ms after a foreign toast,
`StartupTask` is available and toggles, and the appointment store is granted. Without
identity `NotificationChanged` cannot even be subscribed (`0x80070490`), which is exactly the
case ADR-0003's 1 s polling fallback covers (it saw the toast on its first poll, 28 ms). Two
things Windows disagreed with are recorded as amendments: a signed package installs only when
its certificate chain is trusted **machine-wide** (per-user trust is not enough), and the
Tauri CLI has no `signer verify`, so `release:verify` re-implements minisign verification.
The dry run of `release.yml` (I9) needs `workflow_dispatch` from `main` and runs once this
PR has merged; the code-signing eligibility question (I11) is answered with the published
rules and left as a maintainer decision.

## How to run

- `pnpm -w msix:build -- --version 0.0.0 --out dist/local --test-sign --keep-stage` renders
  both manifests from [`scripts/msix/identity.json`](../../scripts/msix/identity.json), packs
  `Muna_0.0.0_x64.msix` and `Muna_0.0.0_x64-external.msix` with `MakeAppx pack /nv` and, with
  `--test-sign`, signs them with the ephemeral certificate from
  [`scripts/msix/test-cert.ps1`](../../scripts/msix/test-cert.ps1) (`CN=Muna Test Signing`,
  30 days, `CurrentUser\My`; nothing is committed). `--keep-stage` leaves the loose layouts
  under `dist/local/.msix-stage/{full,external}` for Developer-Mode registration.
- Full package, no elevation: `Add-AppxPackage -Register dist\local\.msix-stage\full\AppxManifest.xml`
  (Developer Mode), launch with `explorer.exe shell:AppsFolder\<PackageFamilyName>!Muna`,
  remove with `Remove-AppxPackage`.
- External location: [`scripts/identity/register-external-location.ps1`](../../scripts/identity/register-external-location.ps1)

  ```powershell
  scripts\identity\register-external-location.ps1 -Package dist\local\.msix-stage\external\AppxManifest.xml `
    -InstallDir apps\desktop\src-tauri\target\release -Strict
  scripts\identity\register-external-location.ps1 -Remove
  ```

  The script fails soft (exit 0, JSON `status: failed`, rollback) unless `-Strict`; the NSIS
  hook calls it without `-Strict`.
- Probe: `cargo run --release -p muna-probe -- --out <file.jsonl>` (unpackaged), or inside a
  registered package (stdout is not forwarded from a package context, hence `--out`):

  ```powershell
  Invoke-CommandInDesktopPackage -PackageFamilyName <pfn> -AppId Muna -Command <muna-probe.exe> -Args "--out <file>"
  ```

  The probe sends one toast from Windows PowerShell's AUMID — a *foreign* notification — and
  records only counts, change kinds and notification ids, never a body. Appx cmdlets run in
  Windows PowerShell 5.1 with a clean `PSModulePath`; both scripts do that themselves.
- Pipeline scripts, locally: `release:updater` (needs `TAURI_SIGNING_PRIVATE_KEY_PATH` from a
  throwaway `tauri signer generate` key), `release:appinstaller`, `sbom`, then
  `release:verify -- --dir dist/local --version 0.0.0 --no-authenticode --pubkey <key.pub>`.

## Environment

| Item | Value |
| ------ | ------- |
| Machine / OS build | Windows 11 Pro 25H2, build 26200.9445; Developer Mode on; standard (non-elevated) session |
| Windows SDK (`MakeAppx`, `signtool`) version | 10.0.26100.7705 (`makeappx.exe`), `signtool.exe` 4.00 |
| Test certificate subject (must equal the manifest `Publisher`) | `CN=Muna Test Signing` (`identity.json` › `testPublisher`), thumbprint `95E6…13E8`, `CurrentUser\My` + `CurrentUser\TrustedPeople` |
| Package identity | `miklol.Muna_nkbdsfm1sbmne` (family); full names `…_0.0.0.0_x64__…` / `…_0.0.0.0_neutral__…` (external) |
| Toolchain | Node 24.19 (CI: 22), pnpm 10.34.5, Rust 1.98.0, Windows PowerShell 5.1.26100.9444 for Appx |
| Commit | `63e2aa3` (`main`) plus this PR's tree |

Raw artefacts (probe JSONL for the three columns, harness logs, script chain log) are attached
to the PR; they stay out of git.

## Exit criteria

| # | Probe / step | Expected | Unpackaged | External location | MSIX | Pass |
| --- | -------------- | ---------- | ------------ | ------------------- | ------ | ------ |
| I1 | `GetCurrentPackageFullName` | `APPMODEL_ERROR_NO_PACKAGE` unpackaged; full name with identity | `APPMODEL_ERROR_NO_PACKAGE` | `miklol.Muna_0.0.0.0_neutral__nkbdsfm1sbmne` | `miklol.Muna_0.0.0.0_x64__nkbdsfm1sbmne` | ✅ |
| I2 | `UserNotificationListener.RequestAccessAsync` | `Allowed` with identity after consent | `Allowed`, 7 ms, no prompt | `Allowed`, 13 ms | `Allowed`, 16 ms | ✅ (see note) |
| I3 | `GetNotificationsAsync` count | ≥ 1 after a test toast | 15 → 16 | 17 → 18 | 16 → 17 | ✅ |
| I4 | `NotificationChanged` fires within 10 s of a test toast | yes with identity; documented "no" unpackaged → 1 s polling fallback | subscribe fails `0x80070490` (Element not found); 1 s polling saw the toast after 1 poll, 28 ms | fired, **8 ms** (`ChangeKind` Added, id 1240) | fired, **10 ms** (Added, id 1237) | ✅ |
| I5 | `StartupTask.GetAsync` | available with identity; state toggles Enabled ↔ Disabled | `0x80070490` | available; Disabled → `RequestEnableAsync` Enabled → `Disable` Disabled, 36 ms | same, 49 ms | ✅ |
| I6 | `AppointmentManager.RequestStoreAsync` | granted with `appointmentsSystem` (opportunistic) | granted (`AllCalendarsReadOnly`), 7 ms | granted, 9 ms | granted, 13 ms | ✅ (works without identity too) |
| I7 | MSIX installs, launches and uninstalls cleanly with the test cert trusted | yes | — | — | `Add-AppxPackage -Path` with the certificate only in `CurrentUser\TrustedPeople`: **`0x800B0109`** after 5.2 s (chain must be trusted machine-wide; needs elevation). `-Register` loose layout (Developer Mode): 694 ms; `shell:AppsFolder\…!Muna` launches `muna.exe`, alive after 5 s with its `msedgewebview2` child; `Remove-AppxPackage` 367 ms; no `%LOCALAPPDATA%\Packages\<pfn>` left behind | ✅ with amendment |
| I8 | `Add-AppxPackage -ExternalLocation` registers; rollback snippet removes it | yes | — | signed `.msix` without machine trust: fails soft (exit 0, `status: failed`, nothing to roll back, 5.1 s). Loose layout `-Strict`: registered in 284 ms, `AllowExternalContent=true`; probe and `muna.exe` (launched from `target\release` via the package alias) have identity; re-register replaces the previous registration (upgrade path); `-Remove` 668 ms, 0 packages left. Failure path (full manifest passed as external): `0x80073D2E`, exit 1 under `-Strict`, 0 packages left. Skip path: with the full MSIX installed the script reports `skipped` and `-Remove` keeps the MSIX | — | ✅ |
| I9 | `release.yml` dry run (`workflow_dispatch`, `dry_run=true`) | unsigned NSIS + MSIX artefacts uploaded (run URL) | Runs from `main` after this PR merges; run URL goes into the M0 closing PR. Open question it answers: whether the `release-dry-run` environment works on a free private plan | | | ⏳ |
| I10 | `msix:build`, `release:appinstaller`, `release:updater`, `release:verify`, `sbom` | implemented against [11 › root scripts](../11-ci-cd.md#root-scripts-the-workflows-call); exit 0 locally | `msix:build` packs + test-signs both packages (3.21 MB / 9.8 KB); `release:updater` 1.2 s (`tauri signer sign` + `latest.json`); `release:appinstaller` 0.7 s; `sbom` 2.8 s (24 npm + 321 cargo components); `release:verify` 8/8 with `--no-authenticode`, and with Authenticode on it correctly fails 3/11 (unsigned exe, untrusted test chain) | | | ✅ |
| I11 | Code-signing eligibility | Azure Artifact Signing (Basic) or SignPath Foundation: eligible? cost per month | **Azure Artifact Signing** (the product formerly called Trusted Signing): Public Trust certificates are issued to *organisations* in the US, Canada, EU, UK, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway and Israel; *individual developers* only in the US or Canada; Basic and Premium SKUs, billed monthly (price not recorded here — read it off the Azure pricing page when deciding). **SignPath Foundation**: free, but requires an OSI-approved licence, no proprietary components and a public open-source project — not available while this repository is private (and it has no `LICENSE` file yet) | | | ⏳ maintainer decision |

Note on I2: on this machine listener access had been granted to the `miklol.Muna` family during
an earlier run of this spike, so no consent prompt appeared in the recorded runs; first-run
consent UX was not re-observed. `RequestAccessAsync` also returns `Allowed` **unpackaged**, so
the Notifications module must not treat `Allowed` as "events will work" — it has to try the
subscription and fall back to polling on `0x80070490`.

## Observations

- **Unpackaged is better than ADR-0003 assumed.** `RequestAccessAsync`, `GetNotificationsAsync`
  and `AppointmentManager.RequestStoreAsync(AllCalendarsReadOnly)` all work without identity;
  only `NotificationChanged` (subscription fails with `0x80070490`) and `StartupTask`
  (`0x80070490`) need it. The polling fallback therefore covers the whole unpackaged gap, and
  appointments do not need to be feature-flagged on identity.
- **Signed sideload needs machine-wide trust.** `Add-AppxPackage -Path` rejects a package whose
  chain ends in a certificate that is only in `CurrentUser\TrustedPeople` (`0x800B0109`); the
  store that counts is `LocalMachine\TrustedPeople` / a trusted root, which needs elevation.
  The release certificate (Azure Artifact Signing public trust) chains to a Microsoft-trusted
  root, so end users are not affected; local testing uses Developer-Mode `-Register` of the
  loose layout, which is what `--keep-stage` is for.
- **The same limit applies to the external-location route.** Registering the signed
  `Muna_<ver>_x64-external.msix` without machine trust fails with the same `0x800B0109`; the
  script fails soft as designed. Once the real certificate is in place this becomes a plain
  signed registration; on a dev build the app runs unpackaged with polling.
- **No virtualisation surprises on this route.** Both packaged launches (full and external)
  logged to the real `%LOCALAPPDATA%\Muna\logs\muna.log` and no
  `%LOCALAPPDATA%\Packages\miklol.Muna_…` folder was created (`unvirtualizedResources` /
  `FileSystemWriteVirtualization=disabled`). Caveat: a Developer-Mode loose registration is not
  a signed install; re-check the first signed beta. The `IPolicyConfig` helper process named in
  ADR-0003 was not exercised (no audio module yet) — M2-E3 HUD owns that check.
- **Tooling quirks worth keeping.** `Invoke-CommandInDesktopPackage` does not forward stdout
  (probe writes `--out` JSONL); Appx cmdlets must run in Windows PowerShell 5.1 with a clean
  `PSModulePath` — under PowerShell 7 the implicit-remoting shim deserialises package objects and
  5.1 loads the wrong `Security` module when it inherits 7's module path (both scripts handle
  it). `MakeAppx pack /nv` validated the schema of both manifests without complaint;
  `signtool sign /fd SHA256 /sha1 <thumbprint> /s My` signs an MSIX whose `Publisher` equals
  the certificate `Subject` and refuses otherwise.
- **Tauri CLI has no `signer verify`**, so `release:verify` verifies the minisign signature in
  Node (`scripts/release/minisign.mjs`: BLAKE2b-512 prehash + Ed25519, plus the global
  signature over the trusted comment) against `plugins.updater.pubkey` or `--pubkey`.
- **Scripts are `.mjs`, not `.ts`.** `scripts/msix/build.mjs` and `scripts/version.mjs` follow
  the rest of `scripts/` (plain Node, no TS runner on the release runner); docs 10/11 were
  updated in this PR. `.github/CODEOWNERS` still lists `/scripts/version.ts` and
  `release.yml`'s preflight message says `scripts/version.ts` — both are maintainer-only files
  (checklist below).

## Maintainer checklist (delivered by this spike)

Environment, secrets, variables and rulesets to create, per
[11 › protection rules](../11-ci-cd.md#protection-rules) and
[11 › secrets and environments](../11-ci-cd.md#secrets-and-environments). Items marked *plan*
are blocked on the current GitHub Free private plan: make the repository public or move to a
paid plan first (rulesets, environments with protection rules, secret scanning and private
vulnerability reporting are not available on Free private repositories).

- [ ] Decide the signing route (I11): Azure Artifact Signing needs an Azure subscription, an
      Artifact Signing account (Basic SKU) and **organisation** identity validation unless the
      owner is in the US/Canada; SignPath Foundation needs the repository public with an
      OSI-approved `LICENSE`. Until one exists, releases stay dry runs.
- [ ] Set `publisher` in `scripts/msix/identity.json` to the signing certificate's exact
      `Subject` (the placeholder makes `msix:build` fail on a real release and warn otherwise).
- [ ] *plan* Environment `release`: required reviewer (maintainer), deployment tags `v*`;
      secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_SUBSCRIPTION_ID` (OIDC federated
      credential with subject `repo:miklol/Muna:environment:release`, no client secret),
      `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (from
      `tauri signer generate`, kept only in a password manager and the environment); variables
      `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`.
- [ ] Put the matching updater **public** key into `plugins.updater.pubkey` in
      `apps/desktop/src-tauri/tauri.conf.json` (replaces the placeholder; `release:verify`
      reads it).
- [ ] *plan* Environment `release-dry-run` (GitHub creates it on first use; no secrets, no
      protection) — confirm with the I9 dry run.
- [ ] Repository secret `RELEASE_PLEASE_TOKEN` (fine-grained PAT, contents + pull-requests
      write, 90-day expiry with a calendar reminder) and repository variable
      `RELEASE_AUTOMATION=true` once M0 closes.
- [ ] *plan* Rulesets `main` (PR + 1 review + code owners + required checks `changes`,
      `pr-title`, `docs`, `web`, `rust`, `deps`, `app` + linear history + no force-push/delete)
      and `v*` tags (create: release-please bot + maintainer; no delete/update).
- [ ] *plan* Security: secret scanning + push protection, private vulnerability reporting;
      turn on Dependabot security updates (alerts are already on).
- [ ] `.github/CODEOWNERS`: change `/scripts/version.ts` to `/scripts/version.mjs` (the `.ts`
      path does not exist). Optional: also own `/scripts/identity/` and `/scripts/release/`.
- [ ] `release.yml` preflight message: `scripts/version.ts` → `scripts/version.mjs` (cosmetic).
- [ ] After the first stable release: verify `releases/latest/download/latest.json` and
      `releases/latest/download/Muna.appinstaller` resolve.

## Recommendation

ADR-0003 **validated, with amendments** (recorded in the ADR):

1. Keep both identity routes: full MSIX and external-location registration for NSIS. Both give
   the same API surface (I1–I6 identical); the external route registered in < 300 ms and removes
   cleanly, so the NSIS hook can call `register-external-location.ps1` without `-Strict`.
2. Narrow the identity feature flag to `NotificationChanged` and `StartupTask`. Toast reading
   (`GetNotificationsAsync`) and appointments work unpackaged; the Notifications module must
   probe the subscription (not `RequestAccessAsync`) and fall back to 1 s polling on
   `0x80070490`.
3. Sideload trust is machine-wide: developer installs use Developer-Mode loose registration,
   the external-location step fails soft on unsigned dev builds, and release artefacts must be
   signed with a publicly trusted certificate before the first beta — which makes I11 the
   gating maintainer decision for M5.
4. `release:verify` verifies minisign in Node (no `tauri signer verify` exists); the scripts are
   ESM `.mjs` like the rest of `scripts/`.
