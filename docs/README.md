# Muna documentation

Everything needed to build Muna — a notch / Dynamic Island productivity hub for Windows — from
an empty repo to 1.0. Read in order the first time; afterwards jump by role.

## Core documents

| # | Document | What it answers |
|---|----------|-----------------|
| 01 | [Product vision](01-product-vision.md) | What Muna is, for whom, non-goals, Windows-specific decisions, performance budgets, success metrics |
| 02 | [Feature catalog](02-feature-catalog.md) | Every module and feature with tier (P0–P3) and Windows approach |
| 03 | [Architecture](03-architecture.md) | Stack, process/window model, monorepo layout, module contract, data flows |
| 04 | [Windows platform APIs](04-windows-platform-apis.md) | The API for each feature, identity/undocumented caveats, repos to study |
| 05 | [Design system](05-design-system.md) | Tokens, materials, shape, type, icons, components, accessibility, writing |
| 06 | [Motion spec](06-motion-spec.md) | Spring presets, timings, choreography, reduced motion, performance rules |
| 07 | [Roadmap](07-roadmap.md) | Milestones M0–M5 with epics and exit criteria |
| 08 | [Risk register](08-risk-register.md) | Scored risks, mitigations, assumptions |
| 09 | [Testing & QA](09-testing-qa.md) | Test pyramid, determinism rules, shell scenario suite, perf harness, QA matrix |
| 10 | [Release & distribution](10-release-distribution.md) | Artifacts, versioning, signing, pipeline, installer/update behaviour |

## Decisions (ADRs)

| ADR | Decision |
|-----|----------|
| [0001](adr/0001-tech-stack.md) | Tauri v2 + Rust core + React/TypeScript UI (with native-pill escape hatch) |
| [0002](adr/0002-window-strategy.md) | One transparent window per monitor, DOM-shaped hit-testing in Rust |
| [0003](adr/0003-packaging-identity.md) | MSIX primary, NSIS with external-location identity, polling fallbacks |
| [0004](adr/0004-module-contract.md) | Module registries and the live-activity scheduler |

## Module specs

[`modules/README.md`](modules/README.md) indexes all 26 specs (shell, live activities, media,
HUD, settings, dashboard, calendar, to-do, pomodoro, weather, notifications, bluetooth, system
monitor, drop actions, shelf, window snap, code hosting, keyboard shortcuts, notes, day
progress, screen time, health, AI coding, translation, mirror, support) and the spec template.

## Build plan

[`build-plan/README.md`](build-plan/README.md) — paste-ready kickoff prompts per milestone and
epic, mapped to the custom agents in [`../.github/agents`](../.github/agents).

## Reference

- [MacNotch feature extraction](reference/macnotch-feature-extraction.md) — attributed,
  paraphrased notes on the reference product's modules and site.
- [UI observations](reference/ui-observations.md) — measured anatomy and tokens from the
  reference screenshots that seeded the design system.

## Conventions

- Docs are Markdown, ≤ 100 columns, sentence-case headings, mermaid for diagrams.
- Every spec has a **Status** line (Draft → Accepted → Implemented → Shipped).
- Changes to tokens, presets, budgets or ADRs go through a PR that updates the doc *and* the
  code in the same change.
