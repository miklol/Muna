# ADR-0001 · Tech stack: Tauri v2 + Rust core + React/TypeScript UI

**Status:** Accepted (pending M1 spike validation) · **Date:** 2026-09-14

## Context

Muna needs a transparent, frameless, always-on-top, per-pixel-alpha overlay on every monitor
that animates at 60–120 fps, idles near 0 % CPU, stays under ~120 MB RSS, and talks to a long
list of Windows APIs (SMTC, Core Audio, WinRT Bluetooth/Power/Notifications, Win32 window
management, OLE drag-drop, AppBar). It must also let a small team ship an Apple-grade design
system quickly and reuse it for the marketing site.

## Options considered

| Option | Transparency & overlay | Motion fidelity | Footprint | Platform API access | Team velocity |
|--------|------------------------|-----------------|-----------|---------------------|---------------|
| **Tauri v2 (Rust + WebView2)** | ✅ `transparent`, `decorations:false`, `alwaysOnTop`, `setIgnoreCursorEvents`; WebView2 supports transparent background | ✅ web motion libs, compositor-backed transforms | ✅ ~60–110 MB | ✅ `windows` crate covers WinRT + Win32 | ✅ React/TS + Rust |
| Electron | ✅ mature transparent windows, `setIgnoreMouseEvents(…, {forward:true})` | ✅ | ❌ 150–250 MB, Chromium per app | ⚠️ needs native addons (N-API/C++) or koffi for WinRT | ✅ JS-only |
| WPF (.NET 8) | ✅ `AllowsTransparency` + layered windows; mature overlay ecosystem (EarTrumpet, ModernFlyouts) | ⚠️ good but hand-rolled springs; no `layout` morph equivalents | ✅ ~50–90 MB | ✅ C#/WinRT projections | ⚠️ XAML design-system cost high; no reuse for site |
| WinUI 3 | ⚠️ transparent unlocked windows historically painful; needs Win32 interop | ✅ Composition APIs | ✅ | ✅ | ⚠️ tooling churn |
| Flutter desktop | ✅ via `window_manager` | ✅ Impeller | ✅ ~80 MB | ⚠️ FFI/plugins for WinRT | ⚠️ separate design system |
| Rust-native (egui/iced/slint) | ✅ | ⚠️ immediate-mode/limited text & blur | ✅ tiny | ✅ | ❌ slow for rich UI |

## Decision

Tauri v2 with all platform code in Rust and the UI in React + TypeScript (Tailwind v4,
Motion). Rationale: best footprint-to-fidelity ratio, first-class Rust access to every needed
Windows API, and one component library for app + site.

## Consequences

- WebView2 runtime is required (Evergreen; bootstrapper in the installer). Win10 22H2+ ships it.
- Known Tauri/WebView2 transparency pitfalls (verified in the stack research, see
  [`04-windows-platform-apis.md`](../04-windows-platform-apis.md#tauri-caveats)) must be
  handled in the M0/M1 spike:
  - **Never `hide()`/`show()` the notch window** on Tauri 2.x — white-flash regression
    (tauri #15490/#14831) is only fixed by `noRedirectionBitmap` in 3.0.0-alpha (PR #15410).
    Park the window off-screen instead and set `WEBVIEW2_DEFAULT_BACKGROUND_COLOR=00000000`
    before WebView2 creation.
  - Win10 "renders black" race (tauri #15947): never toggle `WS_EX_LAYERED` mid-animation;
    the hit-test toggle must use `set_ignore_cursor_events` only, once per state change.
  - `shadow: false` is mandatory on undecorated Windows windows (else 1 px white border).
  - `dragDropEnabled: true` (native OLE drop → real file paths) disables HTML5 DnD on
    Windows; in-panel reordering uses pointer events, not HTML5 DnD.
  - No hover-forwarding click-through (tauri #6164) → hit-testing lives in Rust (ADR-0002).
- CSS `backdrop-filter` cannot blur *other apps'* content behind a transparent window; the
  notch is an opaque black material by design, so blur is not required. A Composition
  host-backdrop companion HWND (WinIsland technique) is an optional P3 for the Island shape.
- **Escape hatch:** if WebView2 transparency regresses, render the always-visible *collapsed*
  strip in a native Direct2D/Composition layered window (EchoIsland pattern) and keep the
  WebView for expanded states. Full WPF fallback remains the last resort.
- Tauri has no MSIX bundler (tauri #4818) → custom `MakeAppx` script (ADR-0003).

## Validation (exit criteria of the M1 spike)

Transparent notch window on 2 monitors with different DPI, on Win10 22H2 and Win11 24H2;
spring morph strip→panel at ≥ 58 fps; idle CPU ≤ 0.3 %; RSS ≤ 120 MB; no first-frame flash
across 100 collapse/expand cycles and 20 monitor-change events; click-through verified;
capture-exclusion verified.
