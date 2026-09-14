# ADR-0004 · Module contract & live-activity scheduler

**Status:** Accepted · **Date:** 2026-09-14

## Context

MacNotch's key property is modularity: 20+ optional modules, each with strip, panel, widget and
settings surfaces, coordinated by a collapsed-strip "live activities" rotation. Muna needs the
same without cross-module coupling.

## Decision

- Every module = a Rust backend (`ModuleBackend` trait) + a React frontend (`ModuleFrontend`
  object) registered in two registries; communication only via typed events/commands in
  `packages/contracts`.
- A core **scheduler** owns what the strip shows: modules publish `Activity` (long-lived,
  prioritised, focusable) and `Notice` (short, pre-empting) records; the scheduler resolves the
  current strip content and emits `strip:content`. Modules never draw to the strip directly.
- Capabilities are declared (`strip | panel | widget | hud | drop | snap`) so the shell can
  route drag-over, snap and HUD events to the single owning module.
- Module state is a serialisable snapshot re-sent on `module:<id>:state`; frontends are pure
  functions of state + settings → trivially testable in Storybook/Vitest.

## Consequences

- Adding a module = new folder in `src-tauri/src/modules/` + `src/modules/` + registry
  entries + docs/modules spec; no shell changes.
- The contract could later be exposed to third parties (out of scope v1).
