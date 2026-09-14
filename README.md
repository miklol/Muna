# Muna

**A notch for Windows.** Muna turns the top-centre of your screen into a quiet black strip that
morphs into a productivity hub: now playing with album-art colours, volume and brightness HUD,
calendar and meetings, to-dos, Pomodoro, weather, notifications, Bluetooth batteries, system
stats, drop-anything file tiles and a shelf, window snapping, GitHub/GitLab and AI-coding
status — everything the macOS notch apps do, rebuilt for Windows 10/11 with Apple-grade
motion and a near-zero footprint.

> Status: **planning complete, build not started.** This repository currently contains the
> full research-backed plan, design system, module specs and agent configuration needed to
> start building. See [docs/README.md](docs/README.md).

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

To start: open a session on `main`, paste the **M0-E1** prompt from
[docs/build-plan/m0-foundations.md](docs/build-plan/m0-foundations.md) and pick
`muna-architect`. Epics inside a milestone can run in parallel sessions.

## Contributing

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
