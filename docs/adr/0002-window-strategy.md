# ADR-0002 · Window strategy: one transparent WebView per monitor, DOM-shaped hit-testing

**Status:** Accepted · **Date:** 2026-09-14

## Context

The notch has several visual pieces (strip, panel, module bar, HUD, drop tiles) that morph
into each other. Options: (a) one window per piece, resized/moved constantly; (b) one
transparent window per monitor sized to the maximum expanded bounds, painting shapes in the DOM.

## Decision

(b) One notch window per monitor, sized to `max(panelWidth, barWidth) × (panelHeight + barGap +
barHeight)`, transparent, always-on-top, `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`, `shadow:false`.
The UI publishes the union of painted shape rectangles on every layout change; the Rust side
toggles `set_ignore_cursor_events` as the cursor enters/leaves those rects.

Because Tauri has no Electron-style `forward: true` hover pass-through (tauri #6164), the
cursor is sampled in Rust with a **60 Hz `GetCursorPos` poll that runs only while the cursor is
inside the window bounds** (cheap; ~0.05 % CPU) and idles to 10 Hz otherwise. A `WH_MOUSE_LL`
hook is *not* used: Windows silently removes hooks whose callback exceeds
`LowLevelHooksTimeout`, which a busy WebView process can trigger.

## Why

- Morphs between pieces are pure DOM/`layout` animations — no window resize jank, no DWM
  flicker, no z-order fights between pieces.
- A single compositor surface per monitor keeps GPU/CPU cost flat.
- Windows' per-monitor DPI is handled once per window.

## Consequences

- The window covers a large transparent area; correctness of click-through toggling is
  critical (test suite includes hit-testing scenarios).
- `WS_EX_NOACTIVATE` is temporarily cleared when a text field needs focus (Pinned state).
- Reserved-strip mode registers an AppBar of strip height only; the rest of the window still
  overlays.
- The window is pre-sized with `SetWindowPos(SWP_ASYNCWINDOWPOS | SWP_NOZORDER)` before the
  first paint and re-asserted `HWND_TOPMOST` after every `EVENT_SYSTEM_FOREGROUND` (fullscreen
  apps and UAC-band windows can otherwise cover it).
- Hiding the notch (fullscreen game, monitor removed) moves the window to (−10000, −10000)
  rather than hiding it — see ADR-0001 consequences.
