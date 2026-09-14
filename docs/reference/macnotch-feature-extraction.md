# Reference · MacNotch feature extraction

> Research notes, **not product copy**. Extracted Sept 2026 from the MacNotch marketing site
> (`macnotch.io`, React/i18next bundle, English locale) and the "Notch for Windows" site
> (`apple-notch.vercel.app`). Descriptions are condensed paraphrases; the sites remain the
> copyright of their owners. Use this to check parity, not to copy text.

## MacNotch — site structure

| Section | Purpose |
|---------|---------|
| Hero | "Your notch, your productivity hub." macOS 14+, Apple Silicon & Intel, physical notch optional, multiple displays. Free 14-day trial; one-time licence or subscription; also on Setapp. |
| Quick modules (bento) | Tag per module → screenshot carousel. "MacNotch is modular. Keep only the modules you want active in Settings." |
| Customize | Three tabs: **Modules** (toggle/reorder, default module), **Dashboard** (4 widget slots, profiles incl. time-based switching, collapsed-strip content), **Displays** (Multiple Screens, appearance, Drop Actions, Snap Zones). |
| Screen captures tip | Settings → General → *Show Notch in Screenshots & Recordings* toggle. |
| Features catalog | 4 groups → 21 modules (below). |
| Requirements | macOS 14.0+; notch optional; external displays supported. |
| Q&A | Licensing (3 Macs, MN-XXXX-XXXX keys), refund, supported Macs, hide-from-capture, simplify/customise, languages, transfer. |
| Common bugs | "Notch sits slightly below the menu bar" → Settings → Notch positioning → Vertical alignment → *Nudge notch vs menu bar*. |
| Notch preview | Interactive preview with modes **Live activity / Snap zones / Drop actions**; collapsed view tabs **Media, Notifications, Calendar, Tasks, Bluetooth, System HUD, Pomodoro, Session lock**. |
| Support | Email + Discord. |

## MacNotch — module catalog (4 groups, 21 modules)

### Productivity & daily rhythm ("Daily & work")
1. **Dashboard** — profiles (Focus + time-based switching); widgets: weather, media cards (Spotify, Apple Music, Plex, NetEase, VLC), app/folder launcher (icons/list/paginated), Actions shortcuts, extra scan folders, quotes, day progress, screen time, quick toggles (Persist Never Sleep + Launch at Login), shortcuts & events, mirror. **Four widget slots.**
2. **Media** — album art & gradients; reliable Apple Music artwork; full transport for Spotify/Apple Music/Plex/NetEase/VOX/VLC via Now Playing + browsers + system audio; bars or spectrum visualiser; optional hover-reveal prev/play/next in the strip.
3. **Calendar** — events & reminders from macOS; search by title/location/notes/calendar; overdue filters; countdowns; details; meeting awareness via Focus.
4. **Todo** — add/complete/delete/restore; trash with retention; syncs with Reminders.
5. **Notes** — scratchpad; create/open notes from dashboard.
6. **Pomodoro** — custom work/break cycles; progress UI; completion sounds; optional *Timer Done* overlay.
7. **Day Progress** — one timeline for today (events, reminders, tasks) + bedtime marker; sources chosen in Settings; optional Today summary column; dashboard widget.
8. **Screen Time** — category charts, ranked apps, app-switch counts; follows frontmost app; stays local; insights sidebar; expanded height; dashboard donut widget; day reset, categories, colours, excluded apps.
9. **Health** — rings for breaks/water/mindful; time since last break + streak in header; movement break, guided breathing, desk stretch; water +/−; 20-20-20 eye break full-screen prompt (skippable); goals, intervals, breathing patterns, wind-down, hearing warnings in Settings. No permissions; local.
10. **Weather** — Open-Meteo, no key; compact (temp, condition, H/L, feels like, hourly strip) vs expanded (humidity, wind, UV, pressure chips, sunrise/sunset, 7-day) over a photographic sky matching conditions & time; location or manual city; °C/°F.
11. **Keyboard Shortcuts** — notch Snooze + module navigation; record/clear/replace; *Only when hovering*; snooze duration; Accessibility unlocks global shortcuts.
12. **Notifications** — scan, clear, reply in the notch; optional unread glance in the strip (app icon + name).
13. **App language** — EN, FR, DE, ES, PT-BR, IT, JA, NL, KO, PL, ZH-Hans or System; relaunch to apply; first-expand language prompt.

### Code, AI & language ("Code & AI")
14. **AI Coding (Beta)** — Claude Code & Cursor Agent sessions with live status, recent messages, quick Allow/Deny when CLI waits; expandable list height.
15. **Code hosting** — GitHub PRs, GitLab MRs, Bitbucket PRs awaiting review (+ opened ones); Jira issues via JQL with status transitions; provider/repo selection; refresh.
16. **Translation** — LLM translation via OpenAI or Ollama; provider/model/languages in Settings.

### Notch workflow & system ("Notch & system")
17. **Live Activities** — strip rotation (media, timers, calendar, Bluetooth, app updates); per-source media filters; wider layout on track change; unread glance; Volume & Brightness HUD; short notices; external displays.
18. **Drop Actions** — Shelf, AirDrop, cloud, zip, unzip, image convert, move, copy, open with, Music, trash, eject; *Expand* tile splits rows; "Expand Notch" unlocks >4 actions; order/folders/dividers/width.
19. **Shelf** — carousel stash; drop in, drag out; optional Shelf tile.
20. **Window snap** — drag window to top → layout tiles (halves, thirds, quarters, maximise…); reorder; choose zones; richer previews; static preview while Settings pane open.
21. **Bluetooth** — connected gear with battery (AirPods, headphones, mice, keyboards, trackpads, controllers); low-battery alerts.
22. **System Monitor** — CPU, RAM, storage with visual indicators.

### Help & feedback
23. **Support** — feedback w/ reply email, app help, reviews/Setapp rating, resources.

## MacNotch — screenshot index (local copies in the session research folder)

| Module | Screenshots (macnotch.io/images-features/…) |
|--------|---------------------------------------------|
| Dashboard | demo-04, demo-06, demo-05, dashboard-feature-2, dashboard-feature-3 |
| Media | media-feature, demo-02, media-feature-2…5 (media-feature-5 = collapsed hover-reveal) |
| Calendar | demo-09, demo-10, demo-13, demo-17, demo-27, calendar-feature-2 |
| Todo | demo-11, demo-07, todo-feature-2 |
| Notes | demo-12, demo-19, notes-feature-2 |
| Pomodoro | demo-14, demo-20, pomodoro-feature-2, pomodoro-feature-3 (collapsed) |
| Day Progress | day-progress-feature, day-progress-feature-2 |
| Screen Time | screen-time-feature, screen-time-feature-2 |
| Health | health-feature, health-feature-2…5 |
| Weather | weather-feature, weather-feature-2 |
| Notifications | demo-18, demo-25, notifications-feature-2, -3 |
| AI Coding | demo-21, demo-28 |
| Code hosting | demo-16, demo-24, git-feature-2…4 |
| Translation | demo-15, translation-feature-2 |
| Live Activities | demo-01, demo-26, live-feature-2, live-feature-3/4 (collapsed strips) |
| Drop Actions | demo-23 |
| Shelf | shelf, shelf-feature-2, demo-03 |
| Window snap | window-snap |
| Bluetooth | demo-08 |
| System Monitor | demo-22 |
| Support | support |
| Misc | collapsed-media-album-cover.jpg, logo.png, demo-00…03.mp4 |

## Notch for Windows (apple-notch.vercel.app) — feature list

Free, Windows 10 & 11, by Rahim Saroar Mishu. Landing page: Vite + React + Tailwind, fonts
Syne (display) + DM Sans (body), background `#050507`, indigo→cyan gradient accents, YouTube
demo embed. Features advertised:

- Music controls with album covers blending into colour effects; skip/play.
- Calendar: upcoming dates & meetings pop up in the notch.
- Camera mirror ("quick camera check before your Zoom call").
- Battery indicators.
- File sharing: drop files into the notch.
- Redesigned volume/brightness HUD with sliders that blend into the notch.
- Colours that match your music; smooth animations; blur effects.
- "Seamless Integration" (overlay that doesn't interfere with active windows/gaming),
  "Dynamic Context", "Ultra Lightweight" (minimal RAM, 0 % idle CPU), local processing / no telemetry.
- Right-click → Settings: drag-and-drop modules, colours, size.

## Facts to honour in Muna

- Everything opt-in; module order + default module configurable.
- Per-display control; positioning nudges.
- Hide from captures toggle.
- Four dashboard widget slots; profiles.
- Collapsed strip has exactly two slots (leading icon/art, trailing status) plus a hover-reveal wide form.
