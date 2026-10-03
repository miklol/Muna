# M3 · Daily modules (P1)

Read `docs/07-roadmap.md#m3--daily-modules-4-weeks`. Requires M2 merged. Each epic below is
one session with `muna-module-developer` (backend + UI) unless noted; request
`@muna-design-reviewer` and `@muna-qa-engineer` on the PR.

## Generic module prompt

Use this for every epic, replacing `<id>`:

```text
Implement the `<id>` module end-to-end per docs/modules/<id>.md. Read docs/adr/0004-module-
contract.md, docs/04-windows-platform-apis.md (relevant section), docs/05-design-system.md,
docs/06-motion-spec.md and the reference layout notes in docs/reference/ui-observations.md.

Deliver: Rust backend implementing ModuleBackend (with FakePlatform tests), TS ModuleFrontend
(strip form, panel, dashboard widget, settings pane) registered in the module registry,
settings schema + defaults + migration, i18n keys in packages/i18n/en/<id>.json, Storybook
stories (Default/Empty/Loading/Error/LongContent/RTL/ReducedMotion), Vitest for logic, every
acceptance criterion in the spec covered by a test or a checklist row in
docs/qa/checklists/<id>.md. Work stops when hidden (assert zero timers). Update the spec status
to Implemented and the roadmap table. Do not copy third-party code or marketing text.
```

## Epic-specific notes

- **M3-E1 Calendar** — providers: Microsoft Graph (MSAL PKCE loopback), Google Calendar (OAuth
  loopback), ICS subscriptions (`ical` + `rrule`). Tokens via `keyring` (Credential Manager).
  Live activity "Meeting in 10 min · Join" with meeting-link detection. Windows
  `AppointmentStore` only when packaged, read-only.
- **M3-E2 To-do** — local SQLite first; optional Microsoft To Do via Graph. Quick-add from strip
  when Pinned.

  **Progress.** Landed as one PR stacked on M3-E3 (#28), since it reuses the module wiring
  that PR settled: `muna-core::tasks` (migration 3: `task_lists` + `tasks`, soft delete into a
  retention-bound trash), the `TodoService` (commands, `Notify`-driven wake at the next due
  boundary, purge on every evaluation, refresh on unlock), the `todo:due` strip activity and
  `todo:due:<id>` notice, the contract (`get_todo_snapshot`, `todo_command`, `TodoChanged`),
  the `Checkbox` and `TextField` primitives, the panel (quick-add with `chrono-node` date
  parsing and a due preview, list segments, task rows, trash view) and the settings pane
  ([todo → Implementation notes](../modules/todo.md#implementation-notes-m3-e2)). Sync, the
  quick-add hotkey, notes, task rename and drag reorder are deferred and listed there. An
  `i64` millisecond timestamp exports as a plain `number` through the `Int53` marker; the M0
  IPC rule records the exception.
- **M3-E3 Pomodoro** — replaces the M1 placeholder source; ring in strip; sounds via Web Audio;
  never auto-restart the app while a session runs.

  **Progress.** Landed as one PR stacked on the M2 stack (#27), since it plugs into the
  `ModuleServices` wiring, `apply_module_settings` and the per-module event-sink bridge that
  the media and HUD modules introduced there: the
  `PomodoroTimer` state machine over `muna-core::Clock` (monotonic countdown + wall deadline),
  the `PomodoroService` with its 5 s tick while running and `Notify`-only wait otherwise, the
  strip activity and finished notice, the SQLite session log, the contract
  (`get_pomodoro_snapshot`, `pomodoro_command`, `PomodoroStateChanged`), the panel with the
  ring dial and presets, and the settings pane
  ([pomodoro → Implementation notes](../modules/pomodoro.md#implementation-notes-m3-e3)).
  Presets beyond the three phases, sound, the Timer Done overlay, Focus Assist and Focus
  Target are deferred and listed there; the strip countdown is the `TimerText` trailing slot
  without hover controls. The Storybook states from the generic prompt are covered by the
  `Ring`, `TimerText` and `SegmentedControl` primitive stories rather than a panel story (the
  panel is data-bound to the IPC snapshot; a module story harness is an M3-E9 item alongside
  the dashboard widgets).
- **M3-E4 Weather** — Open-Meteo (no key) with geocoding; location from Windows Geolocation
  (capability `location`) or manual city. Hourly/daily, alerts if available.
- **M3-E5 Notifications** — identity path with `NotificationChanged`, polling fallback
  (1 s) when identity absent; group by app; dismiss/clear; Focus Assist state read-only with
  deep link. Test both installers.
- **M3-E6 Day progress** — pure UI; working-hours settings; strip bar form.
- **M3-E7 Bluetooth** — panel with paired devices, connect/disconnect (journaled
  `BluetoothSetServiceState`), battery (GATT + HFP DEVPKEY), radio toggle.
- **M3-E8 System monitor** — `sysinfo` + `nvml-wrapper`; 1 Hz visible, 10 s hidden; top
  processes; no temps (P3).

  **Progress.** Landed as one PR stacked on M3-E2 (#29): the pull-based
  `muna-platform::SystemStats` trait over `sysinfo` (CPU, memory, volumes, network counters,
  the process walk grouped by executable) with scripted samples in the fake, the
  `SystemMonitorService` that owns the cadence (1 Hz while a window watches, 10 s while only
  the strip gauge is on, parked otherwise) and differences consecutive samples for CPU and
  rates, the opt-in `system-monitor:cpu` strip activity (priority `SYSTEM_GAUGE` 10), the
  contract (`get_system_monitor_snapshot`, `system_monitor_watch`, `SystemMonitorChanged`;
  integers only — byte counts saturate at 2⁵³ − 1 through `Int53`), the six-ring panel with
  the process table, and the settings pane
  ([system-monitor → Implementation notes](../modules/system-monitor.md#implementation-notes-m3-e8)).
  GPU (`nvml-wrapper`) and temperatures are deferred and listed there; Task Manager parity is
  approximate because Windows 11 shows "% Processor Utility" while the PDH idle counters give
  the classic reading.
- **M3-E9 Dashboard** — `muna-ui-engineer`: widget grid composing all P1 modules' widgets,
  drag-reorder with pointer events, sizes S/M/L, edit mode, persisted layout.
