# Muna

**A notch for Windows.** Muna turns the top-centre of your screen into a quiet black strip that
morphs into a productivity hub: now playing with album-art colours, volume and brightness HUD,
calendar and meetings, to-dos, Pomodoro, weather, notifications, Bluetooth batteries, system
stats, drop-anything file tiles and a shelf, window snapping, GitHub/GitLab and AI-coding
status — everything the macOS notch apps do, rebuilt for Windows 10/11 with Apple-grade
motion and a near-zero footprint.

> Status: **M0 (foundations) done, M1 (shell & live activities) next.** The monorepo scaffold,
> Tauri desktop shell, `@muna/ui` (tokens, motion presets, primitives) and `@muna/contracts`
> packages, the CI parity and release scripts, and the window and identity spikes have landed;
> the `release.yml` dry run is green. Plan, design system, module specs and agent configuration
> live in [docs/README.md](docs/README.md).

## Highlights

- **Feels like hardware.** One black object that stretches into panels with spring physics
  (shape leads, content follows), continuous corners, hairline edges. Nothing animates while
  it is idle.
- **Respects Windows.** Overlay mode auto-yields when a title bar or fullscreen app is under it;
  Reserved-strip mode carves out a real AppBar so nothing ever sits beneath it. Notch or
  floating Island shape, per monitor, per DPI.
- **Light.** Tauri v2 + Rust core + WebView2: budgets of ≤ 120 MB RSS, ≤ 0.3 % idle CPU,
  ≥ 58 fps morphs, < 1.5 s start. No telemetry.
- **Modular.** 26 modules behind one contract; each ships with a strip form, panel, dashboard
  widget, settings pane, tests and Storybook states.

## Documentation map

| Start here | Then |
| ------------ | ------ |
| [Product vision](docs/01-product-vision.md) | [Feature catalog](docs/02-feature-catalog.md) |
| [Architecture](docs/03-architecture.md) · [ADRs](docs/adr) | [Windows platform APIs](docs/04-windows-platform-apis.md) |
| [Design system](docs/05-design-system.md) · [Motion spec](docs/06-motion-spec.md) | [Module specs](docs/modules/README.md) |
| [Roadmap](docs/07-roadmap.md) · [Risks](docs/08-risk-register.md) | [Testing](docs/09-testing-qa.md) · [Release](docs/10-release-distribution.md) · [CI/CD rules](docs/11-ci-cd.md) |
| [Build plan (kickoff prompts)](docs/build-plan/README.md) | [Agents](.github/agents) |

## Building with agents

Custom Copilot agents live in [`.github/agents`](.github/agents):

| Agent | Use for |
| ------- | --------- |
| `muna-architect` | Scaffolding, contracts, ADRs, cross-module design |
| `muna-shell-engineer` | Notch window, hit-testing, yielding, HUD, snap — Rust + Win32/WinRT |
| `muna-ui-engineer` | React surfaces, primitives, Storybook, accessibility |
| `muna-motion-designer` | Spring presets, choreography, fps tuning |
| `muna-module-developer` | End-to-end modules (backend + UI + settings + tests) |
| `muna-qa-engineer` | Tests, scenario suite, perf harness, QA checklists |
| `muna-release-engineer` | CI/CD, MSIX/NSIS, signing, updater |
| `muna-docs-writer` | Specs, UX copy, i18n strings, release notes |
| `muna-design-reviewer` | Read-only fidelity/motion/a11y review before merging UI |

To start: open a session on `main`, paste the epic's prompt from the milestone's build plan and
pick the agent it names. **M0** is closed — all four epics landed and the spikes filled in the
exit-criteria tables in [docs/spikes](docs/spikes/README.md); what carried over is listed in
the [roadmap status table](docs/07-roadmap.md#status-tracking). **M1** starts with
[docs/build-plan/m1-shell.md](docs/build-plan/m1-shell.md).

## Development

### Prerequisites (Windows 10/11)

| Tool | Version | Notes |
| ------ | --------- | ------- |
| Node.js | 22 LTS | Pinned in `.node-version`; use `fnm`/`nvm-windows` or the installer. |
| pnpm | 10 | `corepack enable`, or `npm i -g pnpm`. The `packageManager` field pins the exact version and pnpm switches to it automatically. |
| Rust | stable (MSVC) | `rustup` reads `rust-toolchain.toml` and installs the pinned toolchain plus `rustfmt` and `clippy`. |
| Visual Studio Build Tools | 2022 | "Desktop development with C++" workload (MSVC linker + Windows SDK). |
| WebView2 Runtime | evergreen | Preinstalled on Windows 11 and on Windows 10 with Edge; otherwise install from Microsoft. |
| cargo-deny | latest | `cargo install cargo-deny --locked` — only needed for `pnpm -w ci:deps`. |

### First run

```powershell
pnpm install
pnpm -w contracts:generate     # compiles the Rust core once and writes packages/contracts/src/bindings.ts
.\scripts\dev.ps1              # tauri dev with WEBVIEW2_DEFAULT_BACKGROUND_COLOR=00000000
```

`contracts:generate` is required before the first `typecheck`/`build`: the TypeScript bindings
are generated from the Rust command and event definitions by tauri-specta and are committed, so
CI fails if they drift from the Rust source. Re-run it whenever you change anything under
`apps/desktop/src-tauri/src/ipc.rs` or the exported types in `muna-core`/`muna-platform`.

`scripts/dev.ps1` forwards extra arguments to `tauri dev` (for example
`.\scripts\dev.ps1 --no-watch`) and has two switches for shell work: `-HitTest` draws the rects
the notch publishes for hit-testing, and `-FullMotion` lets the dev build ignore the OS
*animation effects off* setting so springs can be measured on a machine with reduced motion
(the app's *Reduced motion* setting still wins; release builds always follow the OS). The
settings window opens by itself only on the very first launch; afterwards use the tray icon.
The Rust workspace has two binaries (`muna` and the `muna-probe` spike harness);
`default-run = "muna"` keeps `cargo run` and `tauri dev` unambiguous.

With the app running, `pwsh scripts/qa/notch-yield.ps1` drives the ten yield scenarios of
[docs/qa/checklists/notch-shell.md](docs/qa/checklists/notch-shell.md) (own test windows only;
`-Scenario Y7,Y8`, `-Reserved`, `-Report out.md`) and exits with the number of failures.

### Repository layout

| Path | Package | What lives here |
| ------ | --------- | ----------------- |
| `apps/desktop` | `@muna/desktop` | Tauri v2 app: React shell (`src/`) and the Rust binary (`src-tauri/`). |
| `apps/desktop/src-tauri/crates/muna-platform` | `muna-platform` | Platform traits, `FakePlatform` for tests, Windows implementations behind `cfg(windows)`. |
| `apps/desktop/src-tauri/crates/muna-core` | `muna-core` | Strip scheduler, settings + migrations, SQLite store. No Tauri or Win32 dependency. |
| `apps/site` | `@muna/site` | Landing page (Vite + React, English only): interactive notch demo built from `@muna/ui` primitives, module catalog mirrored from [docs/02-feature-catalog.md](docs/02-feature-catalog.md) with a drift test, downloads, FAQ and privacy. `pnpm --filter @muna/site dev` (port 1430), `build` → `apps/site/dist` with relative asset URLs, `test`. |
| `packages/ui` | `@muna/ui` | Design system: tokens (`src/tokens`, `@muna/ui/tokens.css` + `fonts.css`), primitives (`@muna/ui/primitives`), motion presets and reduced-motion provider (`@muna/ui/motion`), squircle and notch path helpers (`@muna/ui/shape`), Storybook. |
| `packages/contracts` | `@muna/contracts` | tauri-specta generated bindings (`src/bindings.ts`) and zod schemas. |
| `packages/i18n` | `@muna/i18n` | i18next setup and `locales/*.json`. |
| `scripts` | — | Root scripts the CI workflows call; see [docs/11-ci-cd.md](docs/11-ci-cd.md#root-scripts-the-workflows-call). |

### Everyday commands

```powershell
pnpm -w lint                   # eslint (typed, --max-warnings 0) + stylelint + prettier --check
pnpm -w typecheck              # tsc --noEmit in every package
pnpm -w test                   # vitest (watch); `pnpm -w test --run --coverage` for CI parity
pnpm -w storybook              # @muna/ui Storybook on http://localhost:6006
pnpm -w storybook:desktop      # desktop module states on http://localhost:6007
pnpm --filter @muna/site dev   # landing page on http://localhost:1430
pnpm -w docs:check             # markdownlint + relative-link check
pnpm -w format                 # prettier --write

cargo fmt    --manifest-path apps/desktop/src-tauri/Cargo.toml --all
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test   --manifest-path apps/desktop/src-tauri/Cargo.toml --all-features
```

`pnpm -w ci`, `ci:rust`, `ci:deps` and `ci:app` mirror the four required workflow jobs
one-to-one; run the one that failed before pushing a fix. `storybook:ci` downloads a Chromium
build through Playwright the first time it runs and fails on any axe violation; a story may
opt out of a single rule through `parameters.a11y.config.rules` with a comment saying why.

Windows import `@muna/ui/fonts.css` (Inter Variable, bundled) and `@muna/ui/tokens.css` once,
wrap their tree in `MunaMotionProvider` from `@muna/ui/motion`, and read every spring or timing
from `springs` / `timings` / `useMotionPreset` — never a literal duration.

Dependency patches live in `patches/` and are declared in `pnpm-workspace.yaml` with the reason
and the upstream issue to watch; pnpm refuses to install when a patched version no longer
matches, so bumping such a dependency means re-checking whether the patch is still needed.

Rust tests run against `muna_platform::fake::FakePlatform` by default. Tests that need real
Windows APIs are `#[ignore]`d unless the `platform-tests` feature is enabled
(`cargo test --all-features` does this, as CI does on `windows-latest`).

### Performance harness

```powershell
pnpm --filter @muna/desktop tauri build --debug --no-bundle   # the harness needs a CLI-built exe
pnpm -w perf:smoke -- --out perf-smoke.json --markdown perf-smoke.md   # what the `app` job runs (~2 min)
pnpm -w perf:full  -- --exe apps/desktop/src-tauri/target/release/muna.exe --verbose   # nightly plan (~6 min)
```

The harness starts the exe with a scratch profile, reads the shell's `shell ready` and
`webview memory target` log marks, samples CPU and private working set over the whole
process tree, drives expand/collapse morphs in full mode, and exits 1 on a PRD budget breach
([09-testing-qa → Performance harness](docs/09-testing-qa.md#performance-harness-scriptsperf)).
Quit any running Muna first (single instance), and build through the Tauri CLI rather than
plain `cargo build`: only the CLI enables `tauri/custom-protocol`, without which the binary
tries to load the dev server. `perf-*.json` / `perf-*.md` are ignored by git.

### Packaging (local test only)

```powershell
pnpm --filter @muna/desktop tauri build --no-bundle                       # target/release/muna.exe
pnpm -w msix:build -- --version 0.0.0 --out dist/local --test-sign --keep-stage
Add-AppxPackage -Register dist\local\.msix-stage\full\AppxManifest.xml    # Developer Mode, no elevation
Remove-AppxPackage (Get-AppxPackage -Name miklol.Muna).PackageFullName
```

`msix:build` renders the manifests from `scripts/msix/identity.json` and packs both the full
MSIX and the external-location package (`scripts/identity/`). `--test-sign` uses an ephemeral
self-signed certificate that never leaves the machine; a *signed* package only installs when
its chain is trusted machine-wide, so local tests register the loose layout instead
([docs/spikes/m0-identity.md](docs/spikes/m0-identity.md)). `cargo run -p muna-probe` reports
which identity-dependent APIs work in the current process.

Trunk-based: short-lived branches, squash-merged into `main` behind the required checks in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). PR titles are Conventional Commits and
become the changelog; releases are cut by release-please and signed in the protected `release`
environment. The full rulebook — protection rules, quality gates, secrets, runbooks and what
agents may never do — is [docs/11-ci-cd.md](docs/11-ci-cd.md).

## Stack

Tauri v2 · Rust (`windows` crate for Win32/WinRT) · React 19 · TypeScript (strict) ·
Tailwind v4 tokens · Motion springs · Zustand · TanStack Query · tauri-specta + zod contracts ·
SQLite · pnpm monorepo. Decisions and alternatives: [ADR-0001](docs/adr/0001-tech-stack.md).

## Acknowledgements

Muna is an independent Windows project inspired by the macOS notch-app category (MacNotch,
boring.notch, NotchDrop) and by "Notch for Windows". No third-party code, assets or marketing
text are used; reference material is paraphrased and attributed in
[docs/reference](docs/reference).

## License

To be decided before the first public release (see the roadmap's M5 checklist).
