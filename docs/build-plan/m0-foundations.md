# M0 · Foundations & spikes

Read `docs/07-roadmap.md#m0--foundations--spikes-2-weeks` for exit criteria.

---

## M0-E1 · Monorepo scaffold — agent: `muna-architect`

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
5. CI: make .github/workflows/ci.yml `app` job pass on windows-latest (it is gated on
   apps/desktop/package.json existing). Cache pnpm + cargo.
6. `scripts/dev.ps1` that runs `pnpm tauri dev` with WEBVIEW2_DEFAULT_BACKGROUND_COLOR=00000000.

Do not implement features. Do not copy code from AGPL repositories. Finish with `pnpm -w lint
typecheck test` and `cargo clippy --all-targets -- -D warnings` green, and a README section
"Development" explaining setup. Update docs/07-roadmap.md status table (M0 started).
```

## M0-E2 · Transparent-window spike — agent: `muna-shell-engineer`

```text
Validate ADR-0001 and ADR-0002 on real Windows. Read docs/adr/0001-tech-stack.md,
docs/adr/0002-window-strategy.md, docs/04-windows-platform-apis.md#tauri-caveats and
docs/modules/notch-shell.md (Placement, Rendering & hit-testing).

Build `apps/desktop` spike mode (`MUNA_SPIKE=window`): one notch window per monitor showing a
static 200×32 black strip with bottom radius 14 at the top-centre of `rcMonitor`. Implement in
Rust: WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE, HWND_TOPMOST re-assert on EVENT_SYSTEM_FOREGROUND,
pre-size with SetWindowPos(SWP_ASYNCWINDOWPOS), park at (-10000,-10000) instead of hide/show,
GetCursorPos hit-test toggling set_ignore_cursor_events against a shape rect published by the UI,
WM_DISPLAYCHANGE re-creation, WDA_EXCLUDEFROMCAPTURE toggle, SHQueryUserNotificationState poll.

Measure and record in docs/spikes/m0-window.md: flash count over 100 park/unpark cycles
(screen recording + frame diff script), first-paint time, idle CPU (60 s PDH), RSS, behaviour
on monitor hot-plug and DPI change, Win10 22H2 and Win11 24H2 results, whether backdrop-filter
is needed anywhere. If any flash-free/idle criterion fails, prototype the native Direct2D pill
(EchoIsland pattern) for the collapsed strip only and record numbers for both.

Finish with a recommendation section and the ADR status updated (validated / amended).
```

## M0-E3 · Identity & packaging spike — agent: `muna-release-engineer`

```text
Validate ADR-0003. Read docs/adr/0003-packaging-identity.md, docs/10-release-distribution.md
and docs/04-windows-platform-apis.md (Notifications, Packaging).

1. Write scripts/msix/AppxManifest.xml (publisher placeholder, capabilities: runFullTrust,
   unvirtualizedResources, userNotificationListener, globalMediaControl, bluetooth, radios,
   webcam, microphone, location, appointmentsSystem; windows.startupTask extension) and
   scripts/msix/build.ts using MakeAppx pack /nv + signtool with a self-signed test cert created
   by the script (never committed).
2. Write scripts/identity/external-location.manifest.xml (uap10:AllowExternalContent) and a
   PowerShell post-install snippet for the NSIS hook (Add-AppxPackage -ExternalLocation) with
   rollback.
3. Add a Rust probe binary `muna-probe` that reports: GetCurrentPackageFullName result,
   UserNotificationListener RequestAccessAsync, GetNotificationsAsync count, whether
   NotificationChanged fires within 10 s of a test toast, StartupTask availability,
   AppointmentManager access.
4. Run the probe unpackaged, under external-location identity, and inside the MSIX; record a
   pass/fail table in docs/spikes/m0-identity.md. Verify Azure Artifact Signing / SignPath
   eligibility for the project owner and note cost.

Finish with ADR-0003 status updated and .github/workflows/release.yml skeleton (no secrets).
```

## M0-E4 · Design tokens & motion presets — agent: `muna-motion-designer`

```text
Turn docs/05-design-system.md and docs/06-motion-spec.md into code. Read both fully, plus
docs/reference/ui-observations.md.

Deliver in packages/ui:
1. `tokens.css`: every CSS custom property from the design system (colour, alpha surfaces,
   type scale, radii, spacing, shadows, materials) with `@media (prefers-color-scheme)` and
   `[data-contrast=more]` variants; Tailwind v4 `@theme` mapping.
2. `motion/presets.ts`: spring presets as **physics springs** (`stiffness / damping / mass`
   exactly as tabled in the motion spec, plus derived `response`/`dampingFraction` helpers
   and a `toLinearEasing()` export for pure-CSS hovers) exported as Motion `Transition`
   objects; `useMotionPreset(name)` honouring the app's reduced-motion setting;
   `MotionConfig` wrapper. Never emit `{ duration, bounce }` for shell presets — they must
   inherit velocity when interrupted.
3. Primitives: `NotchSurface` (black material; continuous corners via
   `CSS.supports("corner-shape","squircle")` → `corner-shape: squircle`, else figma-squircle
   `clip-path: path()` at smoothing 0.6, swapped in only at rest; `shape="notch" | "island"`
   where notch renders the flared-fillet SVG path), `Hairline`, `IconButton` (28 px), `Chip`,
   `ProgressTrack`, `Text` (type-scale variants), `Ring`.
4. Storybook "Foundations" pages: Colour, Type, Radii, Materials, Motion (interactive spring
   playground comparing presets side by side), Reduced motion.
5. Vitest snapshot of the token list so unintended token changes fail CI.

No module UI. Every value must come from the docs; if a value is missing, add it to the doc in
the same PR with a short rationale.
```
