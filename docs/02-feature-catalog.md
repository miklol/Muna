# 02 · Feature catalog

> Source of truth for **what Muna does**. Every module below was extracted from the
> MacNotch marketing catalog (`macnotch.io/#features`, English locale, Sept 2026) and the
> "Notch for Windows" landing page (`apple-notch.vercel.app`), then mapped to a Windows
> implementation approach and a priority tier. Raw extraction lives in
> [`reference/macnotch-feature-extraction.md`](reference/macnotch-feature-extraction.md).

## Priority tiers

| Tier | Meaning | Ships in |
| ------ | --------- | ---------- |
| **P0** | Core notch experience. Without it Muna is not a product. | M1–M2 |
| **P1** | Parity with MacNotch's daily-driver modules. | M3–M4 |
| **P2** | Differentiating / power-user modules. | M5 |
| **P3** | Nice-to-have, or blocked by Windows platform limits. | Backlog |

Every module is **optional and toggleable** in Settings (MacNotch's "everything is opt-in"
principle). Modules can be reordered on the module bar and one is chosen as the default
module that opens on expand.

---

## A. Notch shell (the product itself)

| # | Feature | MacNotch behaviour | Muna on Windows | Tier |
| --- | --------- | -------------------- | ----------------- | ------ |
| A1 | **Collapsed strip** | Black pill flush with the top edge; rotates *live activities* (media, timers, events, Bluetooth, unread notifications). Left slot = icon/artwork, right slot = status (visualizer bars, timer digits, battery). | Same. Two-slot layout, content driven by a live-activity priority queue. Configurable height (Windows has no menu bar: default 32 px, "compact" 24 px). | P0 |
| A2 | **Hover-reveal strip** | Hovering the strip briefly widens it to show title + prev/play/next (media) or reset/pause/skip/close (Pomodoro). | Same, gated by hover-intent delay. | P0 |
| A3 | **Expanded panel** | Hover/click expands into a ~ 960×300 pt black-glass panel hanging from the top edge with large bottom radii; header = module title + context chips + circular icon buttons; right-side vertical icon rail for quick module jumps; collapse button (⤡) bottom-right. | Same anatomy. Panel is a separate always-on-top layered window sized to content; spring-morphs from the strip. | P0 |
| A4 | **Module bar** | Floating pill under the panel with one icon per enabled module; active module highlighted. | Same. | P0 |
| A5 | **Works without a physical notch / on external displays** | Draws a fake notch on notchless Macs & external monitors; per-display toggle in *Multiple Screens*. | Windows never has a notch, so Muna always draws its own. Per-monitor enable/disable, per-monitor position (centre / offset). DPI per-monitor v2 aware. | P0 |
| A6 | **Notch positioning** | *Nudge notch vs menu bar* vertical alignment. | Vertical offset + horizontal offset settings; **Overlay mode** (floats over windows, auto-hides when a foreground window's title bar is beneath it or when a fullscreen app is active) vs **Reserved-strip mode** (registers an AppBar to reserve the top strip so maximised windows sit below it, like the macOS menu bar). | P0 |
| A7 | **Hide from screenshots & recordings** | Toggle "Show Notch in Screenshots & Recordings". | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` (Win10 2004+) on all Muna windows. | P0 |
| A8 | **Keyboard shortcuts** | Snooze the notch, module navigation, "only when hovering", snooze duration. | Global hotkeys via `RegisterHotKey`; recorder UI in Settings. | P1 |
| A9 | **Settings window** | Dark card-based settings with sidebar + search, per-module panes, light/dark toggle. | Same design language, separate window. | P0 |
| A10 | **App language** | 11 locales, follow system, relaunch to apply. | i18next with ICU messages; ship EN first, structure for the same 11 locales. | P2 |
| A11 | **Menu bar icon / right-click menu** | Settings, quit, module shortcuts. | System tray icon + context menu; right-click on the notch opens the same menu. | P0 |
| A12 | **Trial & licensing** | 14-day trial, one-time licence or subscription, 3 devices. | Out of scope for v1 (Muna ships free/open). Keep a `licensing` seam for later. | P3 |

## B. Productivity & daily rhythm

| # | Module | MacNotch description (condensed) | Muna on Windows | Tier |
| --- | -------- | ---------------------------------- | ----------------- | ------ |
| B1 | **Dashboard** | Four widget slots; *profiles* with Focus and time-based switching; widgets: weather, media cards (Spotify/Apple Music/Plex/NetEase/VLC), app & folder launcher (icons / list / paginated sets), Actions shortcuts, quotes, day progress, screen time, quick toggles (incl. *Persist Never Sleep*), shortcuts & events, mirror. Header: profile chip, edit, screenshot, info, settings, collapse. | Same 4-slot grid (2×2 on the panel) with profiles; quick toggles map to Windows: Focus Assist / Do Not Disturb, Night light, Bluetooth, Wi-Fi, Keep-awake (`SetThreadExecutionState`), Dark mode, Screen capture. Launcher scans Start Menu shortcuts + custom folders. | P1 |
| B2 | **Media** | Album art + adaptive gradients; full transport for Spotify, Apple Music, Plex, NetEase, VOX, VLC, browsers, system audio; bars or spectrum visualiser; lyrics pane; hover-reveal transport in the strip; output-device picker. | `GlobalSystemMediaTransportControlsSessionManager` (SMTC) covers Spotify, Apple Music for Windows, Edge/Chrome/Firefox, VLC, Groove, foobar (plugin), MPC. Album art via SMTC thumbnail; adaptive gradient from artwork; visualiser from WASAPI loopback (real audio). Optional Spotify Web API for lyrics/like/queue. Output-device switching via Core Audio. | **P0** |
| B3 | **Calendar** | Month grid + day agenda; events & reminders from macOS; search; overdue filters; countdowns; meeting awareness via Focus. | Providers: Microsoft Graph (Outlook/M365 personal & work via MSAL), Google Calendar, ICS/CalDAV subscriptions. Windows Calendar (`AppointmentManager`) only as an optional packaged-mode provider. Join-meeting deep links (Teams/Zoom/Meet). | P1 |
| B4 | **Todo** | Add/complete/delete/restore; trash with retention; syncs with macOS Reminders. | Local-first store (SQLite) + optional Microsoft To Do (Graph `/me/todo`) and Google Tasks sync. | P1 |
| B5 | **Notes** | Scratchpad; create/open notes from the dashboard. | Local markdown notes; quick capture from strip hotkey. | P2 |
| B6 | **Pomodoro** | Customisable work/break cycles; presets (Work 25, Short 5, Long 15, Quick 5, Custom); *Focus Target* attaches the timer to an event/task; ring progress; completion sounds; optional *Timer Done* overlay; live activity in the strip. | Same. Optional Focus Assist while a session runs. | P1 |
| B7 | **Day Progress** | Single timeline for today from events, reminders, tasks; bedtime marker; "long stretch" gap hints with *Add task*; completion %; dashboard widget. | Same, fed by Calendar + Todo providers. | P2 |
| B8 | **Screen Time** | Category donut, ranked apps, app-switch counts, insights sidebar, day reset, categories/colours/excluded apps; usage stays local. | Foreground-window tracking (`SetWinEventHook` EVENT_SYSTEM_FOREGROUND + idle detection `GetLastInputInfo`). All local. | P2 |
| B9 | **Health** | Three rings (breaks, water, mindful); sitting timer; Move / Breathe (4-4-4-4) / Stretch / Eye rest (20-20-20 full-screen prompt); streaks; hearing warnings; goals in Settings. | Same. Hearing warning from system volume + headphone detection. | P2 |
| B10 | **Weather** | Open-Meteo (no key); compact vs expanded height; hourly strip; humidity/wind/UV/pressure chips; sunrise/sunset; 7-day; photographic sky background; location or manual city; °C/°F. | Same (Open-Meteo + `Windows.Devices.Geolocation` with permission, or manual city). | P1 |
| B11 | **Notifications** | Centred alert list with app icon, title, body, time, actions (reply/open/dismiss), unread badge, "Apps" filter chip, unread glance in the strip. | `UserNotificationListener` (requires package identity — see ADR-0003) with graceful fallback (module hidden if permission unavailable). Focus Assist status + toggle. | P1 |

## C. Code, AI & language

| # | Module | MacNotch description (condensed) | Muna on Windows | Tier |
| --- | -------- | ---------------------------------- | ----------------- | ------ |
| C1 | **AI Coding (Beta)** | Claude Code & Cursor Agent sessions in one list with live status (Running/Waiting), model badge, branch, current file, elapsed time, message/token counts, quick Allow/Deny when the CLI waits; Recent section. | Watch Claude Code / Codex / Copilot CLI / Cursor Agent session logs & hooks (Claude Code hooks → local HTTP/IPC). Allow/Deny via terminal keystroke injection or hook response. | P2 |
| C2 | **Code hosting** | GitHub PRs, GitLab MRs, Bitbucket PRs awaiting review (+ ones you opened); pipelines; Jira issues via JQL with status transitions; provider/repo selection; manual refresh. | Same via REST/GraphQL with PAT/OAuth device flow. | P1 |
| C3 | **Translation** | LLM translation via OpenAI or Ollama; language pickers, swap, copy, dictation. | Same (+ Azure OpenAI / any OpenAI-compatible endpoint). Dictation via Windows Speech (`Windows.Media.SpeechRecognition`). | P2 |

## D. Notch workflow & system

| # | Module | MacNotch description (condensed) | Muna on Windows | Tier |
| --- | -------- | ---------------------------------- | ----------------- | ------ |
| D1 | **Live Activities** | Strip rotation across media, timers, calendar, Bluetooth, app updates; per-source media filters; brief wider layout on track change; unread-notifications glance; Volume & Brightness HUD; short notices; same on external displays. Expanded view lists activities with Focus/Unfocus pins. | Same. Live activities are a first-class runtime concept (see architecture). HUD replaces the Windows volume/brightness flyout (hide native flyout, hook volume keys, listen to `IAudioEndpointVolume`). Charging / battery-low / Bluetooth-connect notices. | **P0** |
| D2 | **Drop Actions** | Drop files on the notch to reveal action tiles: Shelf, AirDrop, cloud (iCloud), zip, unzip, image convert, move, copy, open with, Music, trash, eject; *Expand* tile for a second row; ordering/folders/dividers/width in Settings. | Same tile UI. AirDrop → **Nearby Share** (`DataTransferManager`); iCloud → OneDrive / Google Drive / Dropbox folder targets; trash → Recycle Bin (`IFileOperation`); eject → `CM_Request_Device_Eject`. | P1 |
| D3 | **Shelf** | Carousel stash: drop in, drag out later; select/copy/trash; item count in header; optional Shelf tile. | Same. Native drag-out via OLE `DoDragDrop` from the Rust side. | P1 |
| D4 | **Window snap** | Drag a window toward the top to open layout tiles in the notch (halves, thirds, quarters, maximise, custom); reorder/choose up to 10 zones. | Detect window drag (`EVENT_SYSTEM_MOVESIZESTART/END`), show zones, apply with `SetWindowPos`/`DwmGetWindowAttribute` frame correction; multi-monitor aware. | P1 |
| D5 | **Bluetooth** | Connected gear with battery: AirPods, headphones, mice, keyboards, trackpads, controllers; connect/disconnect; low-battery alerts. | `Windows.Devices.Enumeration` + Bluetooth LE battery GATT + HFP battery for classic headsets; connect/disconnect via `BluetoothSetServiceState` (best effort). | P1 |
| D6 | **System Monitor ("System Analytics")** | Live CPU, RAM, storage, network, battery, free disk with ring gauges. | PDH counters / `sysinfo`; battery via `Windows.Devices.Power`. GPU via NVML/D3DKMT optional. | P1 |
| D7 | **Session lock** collapsed view | Shows lock status in the strip. | `WTSRegisterSessionNotification` → show lock/unlock notice. | P2 |
| D8 | **Mirror** (dashboard widget) | Camera preview "tiny mirror" (also a headline feature of Notch for Windows). | `Windows.Media.Capture` preview in a widget; privacy indicator. | P2 |
| D9 | **Battery live activity** | Charging / low-battery pill (Notch for Windows: "pretty battery indicators"). | Part of D1 notices. | P0 |

## E. Help & feedback

| # | Module | Description | Muna | Tier |
|---|--------|-------------|------|------|
| E1 | **Support** | Feedback form with optional reply email, app help, reviews, resources. | GitHub Discussions/Issues links, diagnostics bundle export. | P2 |

---

## Features unique to "Notch for Windows" (apple-notch.vercel.app) to keep

| Feature | Notes |
| --------- | ------- |
| Album-art colour blending ("magical color effects") | Covered by B2 adaptive gradients — make it a signature Muna moment. |
| Camera mirror | D8. |
| Battery indicators | D9. |
| File drop → quick share | D2/D3 with Nearby Share. |
| Redesigned volume/brightness HUD | D1 HUD. |
| "Zero impact" positioning: minimal RAM, 0 % idle CPU, no telemetry, local processing | Adopt as hard non-functional requirements (see PRD §Performance budgets). |
| Right-click → Settings, drag-and-drop module arrangement, colour & size options | A9/A11 + appearance settings (accent, size preset). |

---

## Collapsed-strip view types (from the MacNotch preview tablist)

Media · Notifications · Calendar (event) · Tasks · Bluetooth · System HUD · Pomodoro · Session lock.

## Drop-action tiles (from the MacNotch preview)

Shelf (Store files) · iCloud→**Cloud** (Save to Drive) · AirDrop→**Nearby Share** (Send
nearby) · Open with (Smart app) · Expand (Show second row) · Convert (Convert image) · Zip
(Compress) · Move to (Move files) · Copy to (Duplicate) · Music (Play in Music) · Trash / Eject
(Delete files or eject disks).

## Snap zones (from the MacNotch preview)

Top Left · Bottom Left · Left Half · Maximize · Right Half · Top Right · Bottom Right · Thirds
(L/C/R) · custom zones. Up to 10 enabled, ≥ 1.
