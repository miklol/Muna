# 01 · Product vision & requirements (PRD)

## One-liner

**Muna** turns the unused top-centre strip of every Windows monitor into a Dynamic-Island-style
productivity hub: a black notch that shows what is happening now (music, timers, events, devices,
alerts) and expands into a modular dashboard — with the polish of an Apple system UI and the
footprint of a tray utility.

## Why

- MacNotch (macOS) proves the model: 20+ opt-in modules living in the notch, used daily.
- Windows has the same dead space above every window's title bar and no equivalent product with
  Apple-grade fidelity. "Notch for Windows" (free, 2025) validates demand but covers only media,
  calendar, mirror, battery, file drop and HUD.
- Windows exposes everything we need without kernel tricks: SMTC for media, Core Audio for
  volume, WinRT for Bluetooth/notifications/power, Win32 for window management.

## Goals (v1.0)

1. **Feel native to Apple's motion language** — spring-driven morphs, continuous corners,
   black glass, 120 Hz-ready, no jank. This is the primary differentiator; every PR is judged on it.
2. **Full MacNotch module parity where Windows allows it** (see
   [feature catalog](02-feature-catalog.md)): P0 + P1 in v1.0, P2 in v1.x.
3. **Tray-utility footprint**: ≤ 120 MB RSS idle with the panel collapsed, ~0 % CPU idle,
   < 3 % CPU during a 60 fps expand animation on a 2020-era laptop iGPU, cold start < 1.5 s.
4. **Local-first & private**: no telemetry by default; integrations (Graph, Google, GitHub,
   OpenAI…) are explicit opt-ins with tokens in Windows Credential Manager.
5. **Everything optional**: each module toggles; module order, default module, per-monitor
   placement, strip height, appearance presets are user-controlled.
6. **Win10 22H2 + Win11** support; per-monitor DPI; multi-monitor; light and dark wallpapers.

## Non-goals (v1.0)

- macOS/Linux builds (architecture keeps the door open; Tauri is cross-platform).
- Replacing the taskbar or system tray.
- A widgets marketplace / third-party plugin SDK (design the module contract so it *could*
  become one; do not ship it).
- Licensing/payments (Muna v1 is free & open source).

## Personas

| Persona | Needs | Modules they live in |
|---------|-------|----------------------|
| **Developer "Mika"** — 2 monitors, Spotify, GitHub/GitLab, Claude Code/Copilot CLI | glanceable PR queue, agent status, media control without alt-tab, pomodoro | Media, Code hosting, AI Coding, Pomodoro, Dashboard |
| **Knowledge worker "Sam"** — laptop + dock, Teams/Outlook, AirPods | next meeting & join link, notifications triage, Bluetooth battery, quick toggles | Calendar, Notifications, Bluetooth, Dashboard, Health |
| **Enthusiast "Lee"** — customises everything, Rainmeter/PowerToys user | beautiful notch, adaptive album colours, drop shelf, snap zones | Media, Live Activities, Shelf, Drop Actions, Window snap, Weather |

## Core user journeys

1. **Glance** — Music changes → strip briefly widens with art + title, then settles to icon +
   visualiser. Battery hits 20 % → amber notice pill for 4 s.
2. **Peek** — Cursor rests on the strip 250 ms → hover-reveal transport; click ⏭.
3. **Open** — Cursor rests 600 ms or click → panel springs open to the default module; module
   bar appears; switch modules via bar/rail/hotkey; move away → auto-collapse after 800 ms.
4. **Drop** — Drag files toward the strip → panel morphs into Drop Actions; drop on *Shelf* →
   files stashed; later drag them out into an email.
5. **Snap** — Drag a window toward the top → Snap zone tiles; release on *Left half*.
6. **Adjust** — Volume key → Muna HUD in the strip (native flyout hidden).
7. **Configure** — Right-click strip → Settings → toggle modules, reorder, pick monitors.

## Windows-specific product decisions

| Problem | Decision |
|---------|----------|
| Windows has no menu bar; title bars & browser tabs sit exactly under the notch. | Two placement modes. **Overlay (default):** strip is 32 px tall, click-through except on its own pixels, and *auto-yields* (fades to a 6 px "peek" line) when the foreground window's caption/tab area intersects it, when a fullscreen/borderless-fullscreen app is active, or while the user drags a window across it. **Reserved strip:** Muna registers as a top AppBar so maximised windows start below it — the macOS menu-bar experience, at the cost of 32 px of screen. Per-monitor choice. |
| No physical notch anywhere. | Always draw the notch; offer **Notch** (flush, square top corners) and **Island** (floating pill with 8 px top margin, all corners rounded) shapes. |
| Windows volume/brightness flyouts. | Hide the native OSD host window and render Muna's HUD; restore on exit/crash via a watchdog. |
| Notification listener needs package identity. | Ship MSIX (signed) as the primary installer so identity exists; NSIS build for portable users hides the Notifications module with an explanatory Settings note. |
| Exclusive-fullscreen games. | Cannot be overlaid; detect and suspend rendering (also protects perf). |

## Performance & quality budgets (enforced in CI where possible)

| Metric | Budget |
|--------|--------|
| Idle RSS (collapsed, media playing) | ≤ 120 MB total across processes |
| Idle CPU | ≤ 0.3 % averaged over 60 s |
| Expand/collapse animation | ≥ 58 fps at 60 Hz, no long tasks > 50 ms |
| Input → visual response | ≤ 100 ms for hover-reveal, ≤ 16 ms for HUD slider updates |
| Cold start to strip visible | ≤ 1.5 s |
| Installer size | ≤ 25 MB (excluding WebView2 runtime) |
| Crash-free sessions | ≥ 99.5 % |
| Accessibility | Keyboard-operable panel; screen-reader names on all controls; reduced-motion honours OS setting |

## Success metrics (first 90 days after 1.0)

- ≥ 60 % of installs still running after 7 days (tray heartbeat is local; measured via optional
  anonymous ping **off by default** — otherwise via GitHub release download vs. update checks).
- Median enabled modules ≥ 4.
- GitHub: ≥ 1 000 stars, < 5 % of issues tagged `jank`/`perf`.

## Release plan (summary — see [roadmap](07-roadmap.md))

M0 Foundations → M1 Notch shell & Live Activities (P0) → M2 Media + HUD (P0) → M3 Calendar,
Todo, Weather, Bluetooth, System, Pomodoro, Notifications → M4 Dashboard, Drop Actions, Shelf,
Window snap, Code hosting → M5 P2 modules → 1.0.
