# Muna documentation

Everything needed to build Muna — a notch / Dynamic Island productivity hub for Windows — from
an empty repo to 1.0. Read in order the first time; afterwards jump by role.

## Core documents

| # | Document | What it answers |
| --- | ---------- | ----------------- |
| 01 | [Product vision](01-product-vision.md) | What Muna is, for whom, non-goals, Windows-specific decisions, performance budgets, success metrics |
| 02 | [Feature catalog](02-feature-catalog.md) | Every module and feature with tier (P0–P3) and Windows approach |
| 03 | [Architecture](03-architecture.md) | Stack, process/window model, monorepo layout and crate boundaries, module contract, IPC conventions, data flows |
| 04 | [Windows platform APIs](04-windows-platform-apis.md) | The API for each feature, identity/undocumented caveats, repos to study |
| 05 | [Design system](05-design-system.md) | Tokens, materials, shape, type, icons, components, accessibility, writing |
| 06 | [Motion spec](06-motion-spec.md) | Spring presets, timings, choreography, reduced motion, performance rules |
| 07 | [Roadmap](07-roadmap.md) | Milestones M0–M5 with epics and exit criteria |
| 08 | [Risk register](08-risk-register.md) | Scored risks, mitigations, assumptions |
| 09 | [Testing & QA](09-testing-qa.md) | Test pyramid, determinism rules, shell scenario suite, perf harness, QA matrix |
| 10 | [Release & distribution](10-release-distribution.md) | Artifacts, versioning, signing, pipeline, installer/update behaviour |
| 11 | [CI/CD rules](11-ci-cd.md) | Branching, PR titles, rulesets, required checks, quality/perf gates, supply chain, secrets, release automation, runbooks, rules for agents |

## Decisions (ADRs)

| ADR | Decision |
| ----- | ---------- |
| [0001](adr/0001-tech-stack.md) | Tauri v2 + Rust core + React/TypeScript UI (with native-pill escape hatch) |
| [0002](adr/0002-window-strategy.md) | One transparent window per monitor, DOM-shaped hit-testing in Rust |
| [0003](adr/0003-packaging-identity.md) | MSIX primary, NSIS with external-location identity, polling fallbacks |
| [0004](adr/0004-module-contract.md) | Module registries and the live-activity scheduler |

## Spikes

[`spikes/README.md`](spikes/README.md) — time-boxed experiments that validate an ADR with
numbers: plan and exit criteria by `muna-architect`, measurements by the implementing agent
([m0-window](spikes/m0-window.md), [m0-identity](spikes/m0-identity.md)).

## QA checklists

`qa/checklists/` — the manual and scripted scenarios a milestone must pass on real Windows,
with results per run: [notch-shell](qa/checklists/notch-shell.md) (ten yield scenarios, driven
by `scripts/qa/notch-yield.ps1`), [media](qa/checklists/media.md) (media-key latency, driven by
`scripts/qa/media-latency.ps1`) and [hud](qa/checklists/hud.md) (volume and brightness in the
strip, the Windows flyout after a hard kill).

## Module specs

[`modules/README.md`](modules/README.md) indexes all 26 specs (shell, live activities, media,
HUD, settings, dashboard, calendar, to-do, pomodoro, weather, notifications, bluetooth, system
monitor, drop actions, shelf, window snap, code hosting, keyboard shortcuts, notes, day
progress, screen time, health, AI coding, translation, mirror, support) and the spec template.

## Build plan

[`build-plan/README.md`](build-plan/README.md) — paste-ready kickoff prompts per milestone and
epic, mapped to the custom agents in [`../.github/agents`](../.github/agents). Toolchain, first
run and everyday commands for the code itself: [root README › Development](../README.md#development).

## Reference

- [MacNotch feature extraction](reference/macnotch-feature-extraction.md) — attributed,
  paraphrased notes on the reference product's modules and site.
- [UI observations](reference/ui-observations.md) — measured anatomy and tokens from the
  reference screenshots that seeded the design system.
- [Glass UI research](reference/glass-ui-research.md) — primary-source research, ranked
  interface findings, a reusable implementation skill, and measured baseline test results.

## Conventions

- Docs are Markdown, ≤ 100 columns, sentence-case headings, mermaid for diagrams.
- Every spec has a **Status** line (Draft → Accepted → Implemented → Shipped).
- Changes to tokens, presets, budgets or ADRs go through a PR that updates the doc *and* the
  code in the same change.
- Docs are linted in CI (`docs` check) with `markdownlint-cli2` (config in
  [`.markdownlint-cli2.jsonc`](../.markdownlint-cli2.jsonc)) and `scripts/check-links.mjs`
  (relative links and heading anchors). Run `pnpm -w docs:check` before pushing; without the
  workspace installed, `npx --yes markdownlint-cli2@0.23.2 && node scripts/check-links.mjs` is
  the same thing.
