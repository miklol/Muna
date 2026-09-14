# M0 · Foundations & spikes

Read `docs/07-roadmap.md#m0--foundations--spikes-2-weeks` for exit criteria.

---

## M0-E1 · Monorepo scaffold — agent: `muna-architect`

**Status:** landed — [PR #3](https://github.com/miklol/Muna/pull/3).

```text
You are setting up the Muna monorepo from an empty repo that already contains docs/ and
.github/. Read .github/copilot-instructions.md, docs/03-architecture.md (monorepo layout,
stack table), docs/adr/0001-tech-stack.md and docs/09-testing-qa.md first.

Deliver, in one PR:
1. pnpm workspace (pnpm 10, Node 22) with `apps/desktop`, `apps/site` (placeholder Vite app),
   `packages/ui`, `packages/contracts`, `packages/i18n`. Root scripts: lint, typecheck, test,
   format, storybook. Shared tsconfig (strict, `noUncheckedIndexedAccess`), ESLint flat config
   (typescript-eslint strict-type-checked, react-hooks, jsx-a11y, tailwind), Prettier.
2. `apps/desktop`: Tauri v2 (latest stable 2.x) + React 19 + TypeScript + Tailwind v4 + Motion
   + Zustand + TanStack Query. Two windows declared in tauri.conf.json: `notch` (transparent,
   decorations:false, shadow:false, alwaysOnTop, skipTaskbar, focusable:false,
   dragDropEnabled:true, windowClassname "MunaNotch", created off-screen) and `settings`
   (normal). Rust workspace: `src-tauri` binary + crates `muna-platform` (traits + fake impl +
   windows impl behind `cfg(windows)`) and `muna-core` (scheduler, settings, sqlite). Plugins:
   single-instance, autostart, global-shortcut, log, updater (configured, endpoint placeholder).
   tauri-specta generates TS bindings into packages/contracts.
3. `packages/ui`: tokens.css skeleton (see docs/05-design-system.md), primitives folder,
   Storybook 8 with a "Foundations/Tokens" story, Vitest + Testing Library setup.
4. Fake platform: `muna-platform::fake::FakePlatform` implementing every trait with scripted
   events, used by all tests.
5. CI: the `web`, `rust`, `deps` and `app` jobs in .github/workflows/ci.yml are gated on
   apps/desktop/package.json existing and will start running on your PR. Provide every root
   script listed in docs/11-ci-cd.md#root-scripts-the-workflows-call (stubs that exit 0 with a
   clear message are fine where the feature does not exist yet), plus `deny.toml` with the
   licence allowlist from that document. Make all required checks green without editing the
   workflows; if a workflow assumption is wrong, say so in the PR and let the maintainer decide.
6. `scripts/dev.ps1` that runs `pnpm tauri dev` with WEBVIEW2_DEFAULT_BACKGROUND_COLOR=00000000.

Do not implement features. Do not copy code from AGPL repositories. Finish with `pnpm -w lint
typecheck test` and `cargo clippy --all-targets -- -D warnings` green, and a README section
"Development" explaining setup. Update docs/07-roadmap.md status table (M0 started).
```

## Working in the scaffold

State after M0-E1 that the specs do not mention. Every prompt below assumes it.

- **Branch.** E2–E4 need the scaffold. Preferred: wait for PR #3 to merge and branch from
  `main`. Starting earlier: branch from `miklol-animated-couscous` and open the PR against it
  (GitHub retargets to `main` after the squash). E2, E3 and E4 run in parallel sessions.
- **Toolchain.** pnpm 10, Node 22 (CI runs 22.23 — check `engines` before adding a
  dependency), Rust pinned in `rust-toolchain.toml` (MSVC), `cargo-deny`. `pnpm install` at the
  root; the Storybook patch under `patches/` applies itself. `.\scripts\dev.ps1` runs the app.
- **Rust layout.** `apps/desktop/src-tauri` is a Cargo workspace: `muna` (bin + lib),
  `crates/muna-platform` (traits, `fake::FakePlatform`, `windows/` impl behind `cfg(windows)`),
  `crates/muna-core` (scheduler, settings, sqlite). New crates go under `crates/` and into
  `[workspace] members` and `default-members`. `unsafe` only in `muna-platform`
  (`#![forbid(unsafe_code)]` elsewhere; per-module `#[allow(unsafe_code)]` with `// SAFETY:`
  comments; every Win32 call checks its result). `muna` tests live in `tests/` because its
  bin and lib have `test = false`. Run `pnpm -w ci:rust` or cargo with
  `--manifest-path apps/desktop/src-tauri/Cargo.toml`.
- **IPC.** Commands and events are declared with tauri-specta in `src-tauri/src/ipc.rs`;
  `pnpm -w contracts:generate` rewrites `packages/contracts/src/bindings.ts` and `ci:rust` fails
  on a stale file. No 64-bit integers across IPC (specta emits `bigint`).
- **Windows.** `tauri.conf.json` declares `notch` (transparent, undecorated, no shadow,
  top-most, skip-taskbar, not focusable, class `MunaNotch`, created at (−10000, −10000)) and
  `settings`; `setup()` shows `settings` only, there is no tray yet. Capabilities per window in
  `src-tauri/capabilities/`.
- **`@muna/ui`.** Exports `./tokens.css`, `./theme.css`, `./tokens`, `./primitives`, `./motion`.
  `src/tokens/index.ts` parses `tokens.css?raw` into groups and `tokens.test.ts` snapshots the
  list — regenerate on purpose with `pnpm --filter @muna/ui test -- -u`. Storybook 10
  (`pnpm -w storybook`; `storybook:ci` = test-runner + axe), stories next to the source.
  `motion/index.ts` exports only `reducedMotionQuery`; `primitives/index.ts` is empty.
- **Stubs to replace.** `scripts/perf/index.mjs` (`perf:smoke` writes a "not measured" report),
  `e2e` (exit 0), `msix:build`, `release:*`, `sbom` (exit 1 via `scripts/not-implemented.mjs`).
  Scripts are ESM `.mjs` on `scripts/lib.mjs` (`run`, `runAsync`, `repoRoot`); keep that.
- **File ownership.** E2: `apps/desktop/src-tauri/src/**`, `crates/muna-platform/src/windows/**`,
  `docs/spikes/m0-window.md`, ADR-0001/0002. E3: `scripts/msix/**`, `scripts/identity/**`,
  `crates/muna-probe/**`, the `msix:build` / `release:*` / `sbom` root scripts,
  `docs/spikes/m0-identity.md`, ADR-0003. E4: `packages/ui/**`, `docs/05`, `docs/06`. Shared and
  worth an early rebase: `Cargo.toml` + `Cargo.lock` (E2, E3), `package.json` + `pnpm-lock.yaml`
  (E3, E4).
- **Rules.** Never edit `.github/workflows/ci.yml`; `release.yml` only as
  `muna-release-engineer` on an explicit task. If a workflow assumption is wrong, say so in the
  PR. Conventional-Commit title, the PR template, the `Co-authored-by: Copilot App
  <223556219+Copilot@users.noreply.github.com>` trailer, and `pnpm -w ci`, `ci:rust`, `ci:deps`,
  `ci:app`, `docs:check` green before pushing.

## M0-E2 · Transparent-window spike — agent: `muna-shell-engineer`

```text
Validate ADR-0001 and ADR-0002 on real Windows. Read docs/adr/0001-tech-stack.md,
docs/adr/0002-window-strategy.md, docs/04-windows-platform-apis.md#tauri-caveats,
docs/modules/notch-shell.md (Placement, Rendering & hit-testing), the prepared plan
docs/spikes/m0-window.md and docs/build-plan/m0-foundations.md#working-in-the-scaffold.

Build `apps/desktop` spike mode (`MUNA_SPIKE=window`): one notch window per monitor showing a
static 200×32 black strip with bottom radius 14 at the top-centre of `rcMonitor`. Implement in
Rust: WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE, HWND_TOPMOST re-assert on EVENT_SYSTEM_FOREGROUND,
pre-size with SetWindowPos(SWP_ASYNCWINDOWPOS), park at (-10000,-10000) instead of hide/show,
GetCursorPos hit-test toggling set_ignore_cursor_events against a shape rect published by the UI,
WM_DISPLAYCHANGE re-creation, WDA_EXCLUDEFROMCAPTURE toggle, SHQueryUserNotificationState poll.
Add a keyboard-triggered test morph (strip ↔ 360×240 panel with the `expand` / `collapse`
springs from docs/06-motion-spec.md) so morph frame rate can be measured before the M1 shell.

Measure and fill in the W1–W12 table in docs/spikes/m0-window.md: flash count over 100
park/unpark cycles and 20 monitor-change events (screen recording + frame-diff script under
scripts/perf/), first-paint time, idle CPU (60 s PDH), RSS, morph fps, click-through,
capture exclusion, monitor hot-plug, DPI change, quiet-state detection, Win10 22H2 and
Win11 24H2 columns, whether backdrop-filter is needed anywhere. If a flash-free or idle
criterion fails, prototype the native Direct2D pill (EchoIsland pattern) for the collapsed
strip only and record numbers for both.

Finish with the recommendation section filled in and ADR-0001/0002 status updated
(validated / amended).
```

## M0-E3 · Identity & packaging spike — agent: `muna-release-engineer`

```text
Validate ADR-0003. Read docs/adr/0003-packaging-identity.md, docs/10-release-distribution.md,
docs/11-ci-cd.md (release rules, secrets table), docs/04-windows-platform-apis.md
(Notifications, Packaging), the prepared plan docs/spikes/m0-identity.md and
docs/build-plan/m0-foundations.md#working-in-the-scaffold.

1. Write scripts/msix/AppxManifest.xml (publisher placeholder, capabilities: runFullTrust,
   unvirtualizedResources, userNotificationListener, globalMediaControl, bluetooth, radios,
   webcam, microphone, location, appointmentsSystem; windows.startupTask extension) and
   scripts/msix/build.mjs (ESM, on scripts/lib.mjs like the other scripts) using MakeAppx pack
   /nv + signtool with a self-signed test cert created by the script (never committed).
2. Write scripts/identity/external-location.manifest.xml (uap10:AllowExternalContent) and a
   PowerShell post-install snippet for the NSIS hook (Add-AppxPackage -ExternalLocation) with
   rollback.
3. Add a Rust probe binary crate `crates/muna-probe` that reports: GetCurrentPackageFullName
   result, UserNotificationListener RequestAccessAsync, GetNotificationsAsync count, whether
   NotificationChanged fires within 10 s of a test toast, StartupTask availability,
   AppointmentManager access.
4. Run the probe unpackaged, under external-location identity, and inside the MSIX; fill in
   the I1–I11 table in docs/spikes/m0-identity.md. Verify Azure Artifact Signing / SignPath
   eligibility for the project owner and note cost.

Finish with ADR-0003 status updated, a dry run of .github/workflows/release.yml (workflow_dispatch,
dry_run=true) producing unsigned NSIS + MSIX artifacts, and the `msix:build`, `release:*` and
`sbom` root scripts implemented against the contract in docs/11-ci-cd.md (they replace the
exit-1 stubs in package.json). Do not add secrets; write the maintainer a checklist of the
environment, secrets, variables and rulesets to create (docs/11-ci-cd.md#protection-rules and
#secrets-and-environments) in the spike file's "Maintainer checklist" section.
```

## M0-E4 · Design tokens & motion presets — agent: `muna-motion-designer`

```text
Turn docs/05-design-system.md and docs/06-motion-spec.md into code. Read both fully, plus
docs/reference/ui-observations.md and docs/build-plan/m0-foundations.md#working-in-the-scaffold.

Deliver in packages/ui (paths under packages/ui/src):
1. `tokens/tokens.css`: every CSS custom property from the design system (colour, alpha
   surfaces, type scale, radii, spacing, shadows, materials) with `@media (prefers-color-scheme)`
   and `[data-contrast=more]` variants; Tailwind v4 `@theme` mapping in `tokens/theme.css`.
   Keep the existing `tokens/index.ts` parser working (extend its groups if you add one).
2. `motion/presets.ts`, re-exported from `motion/index.ts` (`@muna/ui/motion`): spring presets
   as **physics springs** (`stiffness / damping / mass` exactly as tabled in the motion spec,
   plus derived `response`/`dampingFraction` helpers and a `toLinearEasing()` export for
   pure-CSS hovers) exported as Motion `Transition` objects; `useMotionPreset(name)` honouring
   the app's reduced-motion setting; `MotionConfig` wrapper. Never emit `{ duration, bounce }`
   for shell presets — they must inherit velocity when interrupted.
3. Primitives in `primitives/`: `NotchSurface` (black material; continuous corners via
   `CSS.supports("corner-shape","squircle")` → `corner-shape: squircle`, else figma-squircle
   `clip-path: path()` at smoothing 0.6, swapped in only at rest; `shape="notch" | "island"`
   where notch renders the flared-fillet SVG path), `Hairline`, `IconButton` (28 px), `Chip`,
   `ProgressTrack`, `Text` (type-scale variants), `Ring`. Built on React Aria Components.
4. Storybook "Foundations" pages (extend `foundations/tokens.stories.tsx`): Colour, Type,
   Radii, Materials, Motion (interactive spring playground comparing presets side by side),
   Reduced motion. `pnpm -w storybook:ci` (test-runner + axe) must stay green.
5. Update the Vitest snapshot of the token list (`tokens/tokens.test.ts`, regenerate with
   `pnpm --filter @muna/ui test -- -u`) so unintended token changes fail CI; add unit tests
   for the preset helpers.

No module UI. Every value must come from the docs; if a value is missing, add it to the doc in
the same PR with a short rationale.
```
