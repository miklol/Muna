# 10 · Release & distribution

How a commit becomes something a user installs, updates and trusts. Decisions in
[ADR-0003](adr/0003-packaging-identity.md); API details in
[04-windows-platform-apis.md](04-windows-platform-apis.md#packaging-update-signing).

## Artifacts

| Artifact | Identity | Update path | Audience |
|----------|----------|-------------|----------|
| `Muna_<ver>_x64.msix` | Yes (package) | App Installer (`.appinstaller` feed) / Microsoft Store later | Default download |
| `Muna_<ver>_x64-setup.exe` (NSIS) | Yes via external-location manifest; falls back to none | `tauri-plugin-updater` (`latest.json`, minisign) | Users who can't install MSIX (policy, older Win10) |
| `Muna_<ver>_x64-portable.zip` | No | Manual | Testers |
| ARM64 variants | Same | Same | Best effort from M5 |

## Versioning

- SemVer; single source of truth `version` in `apps/desktop/package.json`, propagated by a
  `scripts/version.ts` to `Cargo.toml`, `tauri.conf.json`, `AppxManifest.xml` (MSIX needs
  4-part `x.y.z.0`).
- Conventional Commits → `CHANGELOG.md` via `release-please` (or `changesets`).
- Channels: `stable` (tags `vX.Y.Z`), `beta` (`vX.Y.Z-beta.N`), `nightly` (unsigned, CI only,
  labelled in the tray tooltip).

## Pipeline

```mermaid
flowchart LR
  PR[PR checks<br/>lint · test · clippy · storybook · debug build] --> Merge[main]
  Merge --> Nightly[Nightly<br/>perf harness · platform tests · nightly zip]
  Merge --> Tag[tag vX.Y.Z]
  Tag --> Build[windows-latest<br/>tauri build NSIS<br/>MakeAppx MSIX]
  Build --> Sign[Sign both<br/>Azure Artifact Signing / SignPath]
  Sign --> Upd[latest.json + .appinstaller]
  Upd --> Rel[GitHub Release<br/>notes from commits]
  Rel --> Site[apps/site downloads]
```

### `release.yml` steps

1. Checkout, pnpm + Rust caches, `pnpm install --frozen-lockfile`.
2. `pnpm --filter @muna/desktop tauri build` → NSIS installer (`bundle.windows.nsis`,
   `webviewInstallMode: downloadBootstrapper`, `installMode: currentUser`).
3. `scripts/msix/build.ts`: stage the built `apps/desktop/src-tauri/target/release/` output,
   render `AppxManifest.xml` (version, publisher, capabilities), `MakeAppx pack /nv`.
4. Sign: `signtool sign /fd SHA256 /tr <tsa> /td SHA256` via Azure Artifact Signing dlib
   (OIDC federated credential from GitHub Environment `release`), or SignPath GitHub Action.
5. `tauri signer sign` (minisign) for the updater; generate `latest.json` with notes.
6. Generate `Muna.appinstaller` pointing at the release asset URL.
7. Create GitHub Release, upload assets, publish; trigger `apps/site` deploy.

### Secrets & environments

- GitHub Environment `release` with required reviewers; secrets: `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID` (OIDC), `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- No certificates in the repo. Test signing for CI uses an ephemeral self-signed cert created in
  the job and never uploaded.

## Installer behaviour

- **NSIS**: per-user, no admin; installs WebView2 bootstrapper if missing; registers
  external-location identity (`Add-AppxPackage -ExternalLocation`) and rolls back silently
  if it fails; optional autostart; uninstall restores native OSD and removes AppBar.
- **MSIX**: capabilities listed in ADR-0003; `windows.startupTask` disabled until user opts in;
  `unvirtualizedResources` so settings live in `%APPDATA%\Muna` for both installers.
- **Upgrade**: settings schema migrations run on first launch; previous version's
  `settings.json` backed up as `settings.<ver>.bak`.
- **Uninstall**: leaves `%APPDATA%\Muna` unless the user ticks "remove my data".

## Update UX

- Check on launch + every 6 h (`updater.endpoints`), silent download, notch notice "Update
  ready — Restart" with a 24 h snooze; never auto-restart while media plays or a Pomodoro runs.
- MSIX users see App Installer prompts; the notice deep-links to `ms-appinstaller:`.

## Release checklist

- [ ] Milestone exit criteria met; perf nightly green 7 days.
- [ ] `CHANGELOG.md` reviewed for user language.
- [ ] Fresh-install + upgrade tested on Win10 22H2 and Win11 24H2 (MSIX and NSIS).
- [ ] Signature verified (`Get-AuthenticodeSignature`, `Get-AppxPackage`).
- [ ] Native OSD restored after uninstall; no AppBar left registered.
- [ ] Site downloads and `latest.json` point at the new version.

## Store readiness (post-1.0)

Same MSIX; pass Windows App Certification Kit (note tauri #14935 S-mode check), Store listing
assets from `apps/site`, privacy policy page (no telemetry).
