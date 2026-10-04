# Screen Time

**Tier P2 · Owner: `muna-shell-engineer` + `muna-module-developer` · Status: implemented
(M4-E8) — see [Implementation notes](#implementation-notes-m4-e8)**

## Reference

`screen-time-feature`, `-2`. Insights column (Avg / Longest session, Categories with dots +
durations, `Settings ›`), "Now" card (app icon + name + duration), donut (1h 50m today) +
stacked category bar + legend, App ranking bars. Header chips: total, switch count, layout toggle.

## Platform

`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` + `GetWindowThreadProcessId` →
`QueryFullProcessImageNameW`; idle via `GetLastInputInfo` (≥ 5 min pauses attribution); lock
via session notifications; browser tabs optional later via UI Automation (`UIA_NamePropertyId`
of the window title). Icons via `SHGetFileInfo`. SQLite `usage_sessions` (exe, start, end).
Categories: rule-based defaults + user overrides; excluded apps; day reset hour.

## Acceptance criteria

- Data never leaves the machine; export CSV.
- Attribution error ≤ 2 % vs. a manual log over a 1-hour test.
- Hook overhead ≤ 0.1 % CPU.

## Implementation notes (M4-E8)

Nothing new hooks the desktop: the module listens to the foreground, idle and lock signals the
platform layer already raised for the shell, and turns them into spans in SQLite. An app is its
**lower-case executable name** (`code.exe`) — stable across updates and install paths; the
last path is kept only to render the icon. Pieces, in the order a switch flows:

- **Platform** (`muna-platform`): `ForegroundWindow.process_path` (the full image path, kept
  out of the IPC contract), `Foreground::idle_for` (`GetLastInputInfo` against `GetTickCount`
  with wrapping arithmetic) and `AppInfo::describe(path, px)` — the version resource's
  `FileDescription` (what Task Manager shows) picked through `\VarFileInfo\Translation`, and
  the shell icon through the shelf's `IShellItemImageFactory` renderer, so the plan's
  `SHGetFileInfoW` row did not materialise. The icon is best effort: when the shell's shared
  thumbnail cache refuses an extraction, the answer still carries the name and the icon is
  tried again once its entry leaves the module's bounded icon cache. `FakePlatform` scripts
  all three.
- **Storage** (`muna-core`, migration 5): `usage_apps` keyed by exe with the display name, the
  last path and the user's choices (category override, excluded, daily limit), and
  `usage_sessions (exe, started_at, ended_at)`. The open span is a row moved forward at every
  flush, so a crash loses at most one flush.
- **Tracker** (`src-tauri/src/modules/screen_time/mod.rs`, Tauri-free `ScreenTimeService`):
  a foreground change closes the span and opens the next one (Muna's own windows and excluded
  apps open nothing); a **10 s tick**, only while the module is on and the session is
  unlocked, closes the span at the moment input stopped once the idle threshold passes and
  reopens the foreground app when input returns, splits the open span at the **day boundary**
  (`dayResetHour`, default midnight), flushes it once a minute, checks the per-app limits and
  prunes spans older than **90 days**. Lock closes the span, unlock reopens
  `Foreground::current()`; two ticks more than 30 s apart mean the machine slept and the span
  ends at the last flush. Spans under one second are dropped. Nothing runs while the module
  is off or the session is locked, which is how the hook stays under the CPU budget.
- **Categories** (`categories.rs`): a rule table by exe → eight buckets (browsing,
  development, communication, media, games, productivity, system, other); the user's override
  in `usage_apps.category` wins. UWP apps surface as `applicationframehost.exe` (system) —
  per-package attribution is deferred.
- **Limits**: minutes per app in `usage_apps`; when today's total passes it the strip shows
  the *screenTimeLimit* notice (`priority::SCREEN_TIME_LIMIT`, 42) once per app per day, and
  the ranking bar turns orange.
- **Snapshot and publishing**: `{ tracking, now, today, apps, categories, week, excluded,
  dayStartMs, generatedAtMs }` — the tracking state (`active | idle | locked | off`), the app
  in front with its 64 px icon as a data URL, today's totals (total, switches, longest and
  average session), the top 20 apps with icons and limits, the categories in legend order,
  the last seven days by category and the excluded list. Snapshots carry icons, so the
  `ScreenTimeChanged` event is published **only while a notch window watches**
  (`screen_time_watch(true)` on mount, `false` on unmount); an idle app publishes nothing.
- **Commands**: `get_screen_time_snapshot`, `screen_time_watch(on)`,
  `screen_time_command({ kind: 'refresh' | 'exclude' | 'include' | 'setCategory' |
  'setLimit' | 'clearHistory' })` and `screen_time_export(title) -> string | null` (a folder
  picker, then `muna-screen-time-<date>.csv` with `start,end,exe,app,category,seconds`,
  revealed in Explorer). **Exclude forgets**: excluding an app deletes its history and stops
  recording it; *Clear history* deletes every span and keeps exclusions, categories and
  limits. Error codes `screenTime.unknown | io`. Settings
  `settings.modules['screen-time'] = { enabled (true), idleMinutes (5, 1–60), dayResetHour
  (0, 0–23) }`. Zod schemas, `categoryShares`, `limitProgress`, `weekScaleMs` and the limit
  presets live in `@muna/contracts`.
- **Panel** (`src/modules/screen-time/panel.tsx`): head chips (today's total, switches), a
  selectable *Week* chip and *Settings*; then the **insights column** — the `SegmentedRing`
  donut of today's categories with the total inside, the legend (categories with time, in
  legend order) and *Average session* / *Longest session* — beside the **now card** (the app
  in front with its category and *since 14:31*, or *Away*, *Locked*, *Screen time is off*,
  *Nothing yet* with one line saying why) and the **ranking** (rows with icon, name, duration
  and a bar of the leader's share; an app with a limit draws its limit progress and turns
  orange once reached). *Week* swaps the columns for seven stacked bars by category, today
  last and labelled, with the daily average over the days that have time. A row opens the
  app's **details**: sessions and longest, category chips, the daily limit presets (None, 15
  min … 4 h) and *Exclude this app*. Since-times are static from the snapshot — the UI runs no
  timers; Rust publishes each tick while watched.
- **Widget** (`widget.tsx`): the small donut, today's total and what is in front (*Away*,
  *Locked*, *Off*); a wide card adds the three leading apps.
- **Settings pane** (`settings.tsx`): *Count screen time*, *Pause after* (1–60 min), *Day
  starts at* (a clock hour), the excluded apps with *Include*, *Export CSV* (says where the
  file went) and *Clear history* with an inline confirmation.
- **Against the plan**: the `AppIcons` trait became `AppInfo` (name and icon in one call, no
  `SHGetFileInfoW`); browser-tab attribution through UI Automation stays deferred (window
  titles are never read); the day boundary is computed in the machine's zone at every tick,
  so a DST change inside the week shifts the earlier days' boundaries by an hour.
