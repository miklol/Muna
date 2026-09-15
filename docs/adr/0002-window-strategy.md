# ADR-0002 · Window strategy: one transparent WebView per monitor, DOM-shaped hit-testing

**Status:** Accepted (validated on Win11 25H2 by the M0-E2 spike, results in
[spikes/m0-window](../spikes/m0-window.md); Win10 22H2 column pending) · **Date:** 2026-09-14
· **Amended:** 2026-09-15 (WebView2 process switches, top-most re-assertion, cursor-poll
thread)

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
`LowLevelHooksTimeout`, which a busy WebView process can trigger. The poll runs on a dedicated
OS thread with `std::thread::sleep` (high-resolution waitable timer): a tokio timer parks on
the 15.6 ms system tick and turned a 16.7 ms period into 31 ms in the spike.

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
  apps and UAC-band windows can otherwise cover it). The assert runs **three times: on the
  hook, 20 ms later and 250 ms later** — Windows raises a newly activated topmost window
  *after* delivering the event, so the immediate assert alone lost every time in the spike.
  A topmost window that appears without a foreground change is not covered by this rule
  (M1 follow-up: `EVENT_OBJECT_SHOW` / `EVENT_OBJECT_REORDER` filtered to topmost windows).
- Click-through is `WS_EX_LAYERED | WS_EX_TRANSPARENT` toggled with `SetWindowLongPtr` (no
  `SWP_FRAMECHANGED`); `WS_EX_TRANSPARENT` alone does not pass clicks through a top-level
  window. The shell owns `GWL_EXSTYLE` after creation because tao rewrites it wholesale.
- Hiding the notch (fullscreen game, monitor removed) moves the window to (−10000, −10000)
  rather than hiding it — see ADR-0001 consequences.
- **WebView2 runs with `--in-process-gpu --process-per-site` and
  `SpareRendererForSitePerProcess` disabled** (`additionalBrowserArgs`, the identical string
  on every window — WebView2 shares one browser process per user data folder and rejects a
  second environment with different switches). In the default process model the idle tree
  measured 181–223 MB against the 120 MB budget, the GPU process alone 66–117 MB; with the
  switches it is ≈ 100 MB and morphs lost no frame time (spike W5/W6). Costs: a GPU-driver
  crash takes the browser process down (`ProcessFailed` → the watchdog recreates the windows),
  and the switches are Chromium command-line flags a runtime update may ignore, so the perf
  harness asserts the process shape and total on every run (risk R19).
