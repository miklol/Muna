# Spike M0-E2 · Transparent notch window

**Status:** Planned · **Validates:** [ADR-0001](../adr/0001-tech-stack.md),
[ADR-0002](../adr/0002-window-strategy.md) · **Owner:** `muna-shell-engineer` ·
**Plan:** `muna-architect`, 2026-09-14

Kickoff prompt:
[build-plan/m0-foundations.md](../build-plan/m0-foundations.md#m0-e2--transparent-window-spike--agent-muna-shell-engineer).

## Question

Can one transparent, always-on-top WebView2 window per monitor show the collapsed strip
flash-free and inside the idle budgets, or does the collapsed strip need the native
Direct2D pill escape hatch ([ADR-0001 › consequences](../adr/0001-tech-stack.md#consequences))?

## How to run

- `MUNA_SPIKE=window` with `.\scripts\dev.ps1` (E2 adds the spike mode): one window per
  monitor, static 200 × 32 black strip, bottom radius 14, top-centre of `rcMonitor`.
- A keyboard-triggered test morph (strip ↔ 360 × 240 panel with the `expand` / `collapse`
  springs from [06](../06-motion-spec.md)) so morph fps can be measured before the M1 shell
  exists.
- Measurement scripts live in `scripts/perf/` next to the `perf:smoke` stub; the full harness
  is M1-E3 and is not wired here.

## Environment

| Item | Win11 24H2 run | Win10 22H2 run |
| ------ | ---------------- | ---------------- |
| Machine / GPU | | |
| OS build | | |
| Monitors (resolution @ scale; primary marked) | | |
| WebView2 runtime | | |
| Tauri / wry / tao versions | | |
| Commit | | |

## Exit criteria

Budgets come from
[01 › performance budgets](../01-product-vision.md#performance--quality-budgets-enforced-in-ci-where-possible),
[ADR-0001 › validation](../adr/0001-tech-stack.md#validation-exit-criteria-of-the-m0-e2-spike)
and ADR-0002. Fill in measured values; "Pass" is per row across both OS columns.

| # | Criterion | Budget | Method | Win11 | Win10 | Pass |
| --- | ----------- | -------- | -------- | ------- | ------- | ------ |
| W1 | Flashes over 100 park/unpark cycles ((−10000, −10000) ↔ placed) | 0 | 60 fps screen recording + frame-diff script (`scripts/perf/frame-diff.mjs`): a frame whose strip region differs from both neighbours by > 2 % counts as a flash | | | |
| W2 | Flashes over 20 monitor-change events (`WM_DISPLAYCHANGE`: hot-plug, resolution, scale) | 0 | same recording method | | | |
| W3 | First strip paint after process start | ≤ 800 ms | `main()` timestamp → first paint (CDP `firstContentfulPaint` or `WM_PAINT` log); median of 10 cold starts | | | |
| W4 | Idle CPU, strip visible, cursor elsewhere | ≤ 0.3 % | PDH `\Process(*)\% Processor Time` summed over `muna` + its `msedgewebview2` children, 60 s average | | | |
| W5 | Resident set size after 5 min idle | ≤ 120 MB | PDH `Working Set - Private` summed over the same processes | | | |
| W6 | Test morph strip ↔ panel | ≥ 58 fps, no frame > 32 ms | CDP tracing (`DroppedFrame` / frame timings) over 20 morphs | | | |
| W7 | Click-through | outside the published shape rect clicks reach the window below; inside they hit the strip; `set_ignore_cursor_events` toggles ≤ 16 ms after crossing | `GetCursorPos` poll log + manual | | | |
| W8 | Capture exclusion | `WDA_EXCLUDEFROMCAPTURE` on → strip absent from Snipping Tool / OBS / Teams share; off → present | manual, screenshots attached to the PR | | | |
| W9 | Monitor hot-plug | window created/destroyed per monitor; no orphan, no stale position | attach/detach a display 5 × | | | |
| W10 | Scale change 100 % → 200 % → 100 % | strip stays 200 × 32 DIP at top-centre, no blur | change scale in Settings | | | |
| W11 | Quiet-state detection | `SHQueryUserNotificationState` poll reports fullscreen / presentation within 1 s; strip parks | fullscreen game or video, PowerPoint slideshow | | | |
| W12 | Top-most re-assertion | strip back on top within one frame after `EVENT_SYSTEM_FOREGROUND` from a fullscreen or UAC-band window | manual | | | |

## Escape hatch (only if W1, W2, W4 or W5 fail)

Prototype the native Direct2D / Composition layered window for the collapsed strip only
(EchoIsland pattern), driven by the same Rust state, and record W1–W5 for it in a second table.
WebView2 stays for the expanded states either way.

## Observations

- Is `backdrop-filter` needed anywhere? (Expected: no — black glass is opaque.)
- Anything ADR-0002 assumed that Windows disagreed with (`SWP_ASYNCWINDOWPOS`,
  `WS_EX_NOACTIVATE`, cost of the hook-free cursor poll, …).

## Recommendation

<!-- WebView strip / native pill; ADR-0001 and ADR-0002 validated or amended because … -->

## ADR updates

- ADR-0001: status → *Accepted (validated)* or amended, linking this file.
- ADR-0002: same.
