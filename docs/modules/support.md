# Support & diagnostics

**Tier P2 · Owner: `muna-docs-writer` + `muna-release-engineer` · Status: built (M5-E1a)**

## Scope

In-app help (opens docs site), feedback form (GitHub issue prefilled via URL), diagnostics
bundle (logs, settings without secrets, monitor topology, WebView2 version, OS build) zipped to
Desktop, "Reset flyout / AppBar" repair buttons, changelog viewer, update channel (stable/beta),
"Rate on GitHub" link. No telemetry by default; optional anonymous crash reports (Sentry-compatible,
opt-in, documented).

## Acceptance criteria

- _Save diagnostics_ writes one zip to the Desktop and names it; the zip holds the logs, the
  settings document and a system report, and nothing that identifies the account or holds a
  secret.
- _Send feedback_ opens a GitHub issue whose body already carries the Muna version, the OS
  build and the WebView2 version.
- Both repairs finish in one press and say so; neither needs a restart.
- The update channel is a setting Rust reads back; a check only happens when the user asks.

## Implementation notes (M5-E1a)

The module is a thin service over things the app already owns: the log folder, the settings
file, the HUD and the shell. Nothing here runs on a timer; a closed panel costs nothing.
Pieces, in the order a bug report travels:

- **Platform** (`muna-platform`): the `SystemInfo` trait — `describe()` returns
  `SystemDescription { os, webview2 }` and `desktop_dir()` the user's Desktop.
  `windows/system_info.rs` reads the OS edition and build through `sysinfo`
  (`long_os_version` + `kernel_version`, so the line reads `Windows 11 Pro (build 26200)`)
  rather than the planned `RtlGetVersion`, which gives the same build without the edition; the
  WebView2 runtime version comes from `GetAvailableCoreWebView2BrowserVersionString` (`None`
  when no runtime is installed), the Desktop from `SHGetKnownFolderPath(FOLDERID_Desktop)`, so
  a redirected or OneDrive Desktop is honoured. `FakePlatform` scripts both
  (`set_system_description`, `set_desktop_dir`); no Desktop is the `support.noDesktop` refusal.
- **No `Repair` trait.** The plan tabled one; the repairs turned out to be two calls on
  services the shell already owns, so `ipc.rs` calls them directly: `HudService::repair_flyout`
  clears the suppression cache, shows Windows's own flyouts, then applies the HUD setting
  again (`tests/hud.rs` checks the three requests), and `ShellManager::repair_app_bars`
  releases every app bar and asks for a reconcile, which registers the reserved space again
  for every ready window — what an Explorer restart leaves behind (Windows `AppBars::release`
  is a no-op for a window that is not registered, so the repair is idempotent).
- **Service** (`modules/support/mod.rs`): `SupportSnapshot { version, channel, system,
  profileDir, logsBytes, lastBundle, changelog }`; `SupportCommand` is `diagnostics`,
  `repairFlyouts`, `repairAppBar`, `openLogs`, `checkUpdates`; `SupportOutcome` is `done`, the
  `bundle` record or the `update` answer. The version, the started modules and the changelog
  candidates are set once at startup by `ipc::describe_build`. `SupportChanged` fires after a
  bundle and after a channel change (once per change, not per write).
- **Bundle** (`bundle.rs`): `muna-diagnostics-YYYYMMDD-HHMM.zip` on the Desktop (a numbered
  suffix when the minute already has one), holding `README.txt` (what is inside and what is
  not), `system.txt` (Muna version and channel, OS, WebView2, the profile folder, the started
  modules, generated-at), `settings.json` as written on disk, and `logs/*.log`. Secrets never
  reach the bundle by construction: tokens and feed URLs live in Credential Manager, not the
  settings file, and no notification body is ever logged. Monitor topology is **not** in the
  bundle yet: the shell already logs it at startup, so it is in the logs; a `monitors.txt`
  from `Windowing` is a follow-up.
- **Links** (`link()`): _Help_ opens `docs/README.md` on GitHub until the E5 site exists;
  _Send feedback_ opens `issues/new?labels=bug` with a prefilled body carrying the three
  versions; _Rate_ is the repository; _Release notes_ its releases page. URLs are built in Rust
  with `tauri::Url`; the UI never sees or assembles one.
- **Changelog viewer**: `support_changelog` returns the `CHANGELOG.md` bundled with the build
  (resources, next to the executable, or the repository root in a debug build), and
  `snapshot.changelog` says whether one exists. The panel parses the release-please shape —
  `## version (date)`, `### Features` / `### Bug Fixes`, one bullet per change — and shows
  each release's groups without commit hashes or markup; a build without a changelog opens the
  release notes on GitHub instead. E4 is the epic that bundles the file.
- **Updates**: `settings.modules.support.channel` (`stable` | `beta`) picks the endpoint
  (`releases/latest/download/latest.json` or `releases/download/beta/latest.json`);
  `checkUpdates` asks `tauri-plugin-updater` for that endpoint and reports `{ available,
  version, notes }` — a **check only**, user-initiated, never a download or an install (E4
  wires the signing key and the install path). `crashReports` is reserved (`false`, no
  reporter ships, no toggle shown).
- **UI**: the panel is one list — help, feedback, save diagnostics, what's new, repair, rate —
  under a line naming the version and the machine, with the repairs and the changelog one
  level down and every outcome as one line of status text. Settings → Support has the update
  channel, _Check for updates_ (naming the newer version and pointing at GitHub), the system
  line, the bundle row with the size of the logs it will carry (`formatBytes`, locale-aware),
  the logs folder and the two repairs. Settings → About keeps its _Open logs folder_.

QA: [checklist](../qa/checklists/support.md).
