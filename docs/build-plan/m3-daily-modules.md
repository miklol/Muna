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

  **Progress.** Landed as one PR stacked on M3-E7: a `muna-platform::Location` trait (fake
  with scripted fixes and denials; Windows `Geolocator` with one `RequestAccessAsync` and one
  `GetGeopositionAsync` per refresh), a provider adapter over `reqwest` for the two Open-Meteo
  endpoints, and a pure `WeatherService` reducer (locate → fetch with a generation counter,
  15 min refresh, 1 → 15 min backoff, cache in `Store` meta keyed by the rounded point,
  sticky *denied* until *Try again*) driven by one tokio task that also wakes on unlock. The
  module is **off by default** and makes no request until the user turns it on; coordinates
  are rounded to 0.01° before they leave the PC. Contract: `get_weather_snapshot`,
  `weather_command(Refresh | RetryLocation)`, `weather_search` (refused while off),
  `WeatherChanged`; floats cross through the new `muna_core::Finite` specta marker. Panel
  with the moment now, reading chips, twelve hours and seven days, gradient skies by
  condition and hour, the stale *Updated* chip, and empty states for off, denied, unavailable,
  failed, loading and offline; Weather settings pane with the switch, current location or a
  searched city, and units, persisting `settings.modules.weather`
  ([weather → Implementation notes](../modules/weather.md#implementation-notes-m3-e4)).
  Deferred: photographic skies and animated icons, alerts, a strip form.
- **M3-E5 Notifications** — identity path with `NotificationChanged`, polling fallback
  (1 s) when identity absent; group by app; dismiss/clear; Focus Assist state read-only with
  deep link. Test both installers.
- **M3-E6 Day progress** — pure UI; working-hours settings; strip bar form.

  **Progress.** Landed as one PR stacked on M3-E4: the UI merges the to-do and pomodoro
  snapshots through the contract (no cross-module imports) into a pure `timeline.ts` — timed
  tasks due today, the running or paused focus phase as a block, an optional bedtime, the
  completion count over timed tasks only, the share of the working day gone and the first
  free stretch of at least 90 minutes left in it. The panel puts the stats on the left and the
  timeline on the right, with a now row that moves between the items on the `layout` spring
  at every whole minute (one aligned timeout, cleared on unmount) and a *Long stretch* row
  offering *Add a task*, which hands over to the to-do module. The Rust half owns
  `settings.modules.day-progress` (working hours, bedtime, strip bar, sources; minutes since
  local midnight, repaired identically on both sides) and the opt-in `day-progress:bar` strip
  activity (hourglass glyph + progress, priority 5, working hours only), sleeping exactly until
  the whole percent changes and reading the local offset at every wake so DST moves the bar
  with the clock ([day progress → Implementation notes](../modules/day-progress.md#implementation-notes-m3-e6)).
  Deferred: calendar and health sources (their modules do not exist yet), the dashboard card
  (E9); the strip form is the day bar rather than "Next in 10m", which `todo:due` covers.
- **M3-E7 Bluetooth** — panel with paired devices, connect/disconnect, device kinds, battery
  (GATT), low-battery notices, hide devices, radio toggle.

  **Progress.** Landed as one PR stacked on M3-E8: the platform grew `BluetoothDeviceKind`
  (from `System.Devices.Aep.Category`, matched by segment), `connect` (best effort: page the
  device, then read `ConnectionStatus`), `disconnect` (`IOCTL_BTH_DISCONNECT_DEVICE` on the
  radio — nothing persisted, so the journaled `BluetoothSetServiceState` plan was dropped) and
  the radio (`Windows.Devices.Radios`, `BluetoothRadioChanged`), all scripted in the fake. The
  `BluetoothService` reduces platform reports into a connected-first snapshot, announces
  `bluetooth:low:<id>` once per threshold (20 orange, 10 red) per connection, and runs the
  blocking commands off the async threads; the contract is `get_bluetooth_snapshot`,
  `bluetooth_command`, `BluetoothChanged`. The panel has the radio switch, a row per visible
  device with connect / disconnect and the refusal in place, and empty states for off,
  unavailable and nothing paired; the settings pane toggles notices and hides devices
  ([bluetooth → Implementation notes](../modules/bluetooth.md#implementation-notes-m3-e7)).
  Classic HFP battery, AirPods adverts and nicknames are deferred and listed there.
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

  **Progress.** Landed as one PR stacked on M3-E6: the registry grew
  `ModuleDefinition.widget` (`WidgetProps = { span: 1 | 2 }`) and each of the seven P1
  modules exports its card as `widget.tsx`, re-using its own hooks, store and formatting
  (media with transport on a wide card, pomodoro ring with start / pause, three soonest tasks,
  weather now with high / low, day-progress share and completion, CPU and memory rings that
  watch only while mounted, connected Bluetooth devices with battery). The dashboard module
  renders them in a 2 × 4 grid (spans 1–2, `layout` spring) with a toolbar pencil for edit
  mode — controls replace the widget bodies (move, wider / narrower, remove), an *Add a widget*
  card lists the modules not on the grid, pointer drag goes through Motion `drag` and the pure
  `dropIndex`, off under reduced motion — and persists one layout in
  `settings.modules.dashboard = { slots }` through the contract's
  `readDashboardSettings` / `writeDashboardSettings`; the Rust half validates the namespace
  and registers an idle `Panel` surface. Disabled modules keep their slot in the document
  but are not drawn. The dashboard is registered first and is the default panel; Settings ›
  Dashboard shows the counts and resets the layout
  ([dashboard → Implementation notes](../modules/dashboard.md#implementation-notes-m3-e9)).
  Deviation: the pencil lives in the panel body rather than the shell header rail. Deferred:
  profiles, launcher, actions, quick toggles, screenshot / info, the widgets of modules that do
  not exist yet, the module story harness.
