# Dashboard

**Tier P1 · Owner: `muna-module-developer` · Status: implemented (M3-E9, first slice)**

## Purpose

Four-slot widget grid with profiles — the default module for most users.

## Reference

`demo-04/05/06`, `dashboard-feature-2/3`. Header: title, profile chip (`Work ›`) + Focus bolt;
right: edit (pencil), screenshot, info, settings, collapse. Grid 2 rows × 4 slots; widgets can
span 1–2 slots.

## Widgets (v1)

Events (next 3) · Reminders/Tasks · Launcher (apps/folders, icons/list/paginated "Set 1 of 2")
· Actions shortcuts (run a Muna action or a shell command) · Pomodoro card · Day Progress card ·
Weather card · Media card · Screen Time donut · Quotes · Quick toggles · Mirror · Bluetooth
devices · System stats mini · Notes quick capture.

**Quick toggles (Windows):** Focus Assist (`WNF`-free approach: open `ms-settings:quiethours`
fallback; Win11 22H2+ use `Windows.UI.Notifications` Focus session APIs where available) ·
Night light (registry toggle `CloudStore` blob — flag) · Bluetooth radio
(`Windows.Devices.Radios`) · Wi-Fi radio · Keep awake (`SetThreadExecutionState`) · Dark/light
theme (`Personalize` registry) · Screen capture hide · Mute mic.

## Profiles

Named sets of 4-slot layouts. Switch manually, on schedule (time ranges), or when a Focus
Assist state is active. Header chip lists profiles.

## Data & platform

Launcher indexes Start Menu `.lnk` files (`%ProgramData%` + `%AppData%`), user folders,
UWP apps via `PackageManager`/`AppsFolder` shell namespace; icons via `SHGetFileInfo` /
`IShellItemImageFactory` cached as PNG.

## Acceptance criteria

- Edit mode: drag widgets between slots, resize span, add/remove; changes persist per profile.
- Time-based profile switch happens within 1 min of the boundary.
- Launcher opens apps with `ShellExecuteEx` and reports failures inline.

## Implementation notes (M3-E9)

The first slice ships the grid and the widgets of the seven P1 modules that exist; profiles,
the launcher, actions, quick toggles and the remaining widgets are deferred (below).

### Contract

- `settings.modules.dashboard = { slots: [{ moduleId, span }] }` — one layout, in grid order,
  `span` 1 or 2, at most 8 cells over the 2 × 4 grid. `DASHBOARD_GRID`, `DashboardSlot`,
  `DEFAULT_DASHBOARD_SLOTS` (media 2 · pomodoro · todo · weather · day-progress · system-monitor
  · bluetooth), `clampDashboardSlots`, `readDashboardSettings` / `writeDashboardSettings` live
  in `@muna/contracts`. Both sides repair the document identically: duplicates drop, a slot
  that no longer fits the remaining cells is skipped, and a malformed entry falls back to the
  default layout.
- The Rust module (`modules/dashboard`) owns namespace validation and registers a `Panel`
  surface with nothing else to do — the dashboard has no platform work and no strip form.
- `ModuleDefinition.widget?: ComponentType<WidgetProps>` is the new registry slot
  (`WidgetProps = { span: 1 | 2 }`). Each module exports its card as `widget.tsx`; the
  dashboard renders it inside a `Card` titled with the module's name and an *Open* button that
  activates the module's panel. The dashboard is registered first and so becomes the default
  panel, as the spec asks.

### Grid and edit mode

- The panel body is 284 px tall (shell panel 360 − chrome), which gives two rows of 120 px
  cards with a 68 px body; a narrow card is about 166 px wide, a wide one about 340 px. The
  toolbar above the grid shows how many widgets are on it and the pencil that toggles edit mode.
- **Deviation from the reference:** the pencil sits in the panel body, not in the shell's header
  rail — modules cannot inject into the rail's fixed props. Screenshot and info buttons are
  deferred with it.
- Edit mode swaps every card body for its controls (*Move left / right*, *Wider / Narrower*,
  *Remove*), and an *Add a widget* card lists the modules that have a widget and are not on the
  grid while cells are free. Swapping bodies also unmounts the widgets, so their subscriptions
  stop while the user arranges the grid.
- Reordering uses Motion `layout` (the `layout` preset) for the settle and Motion `drag` with
  `dragSnapToOrigin` for the pointer path; `dropIndex` (pure, unit-tested) resolves the card
  under the release point from measured rects. Drag is off under reduced motion; the arrow
  buttons remain the keyboard path either way.
- Modules that are disabled in Settings or have no widget stay in the stored document but are
  not rendered; edits keep them (`mergeHidden`, appended after the visible slots so the clamp
  drops them first when cells are short) so re-enabling a module brings its card back.
- Settings › Dashboard shows the widget and cell counts and offers *Reset* to the default
  layout.

### Widgets

Media (art, title, artist; transport on a wide card) · Pomodoro (small ring with the countdown
and start / pause / resume) · Tasks (three soonest open tasks, overdue in red, "N more") ·
Weather (glyph, temperature, condition, high / low; place on a wide card) · Day progress (share
of the working day and completion) · System (CPU and memory rings; storage and network on a
wide card; watches at 1 Hz only while mounted) · Bluetooth (connected devices with battery).
Every widget re-uses its module's hooks, store and formatting; none imports another module.

### Deferred

Profiles and scheduled switching, the launcher (Start Menu index, `ShellExecuteEx`), action
shortcuts, quick toggles, screenshot and info buttons, Events / Screen Time / Quotes / Mirror /
Notes widgets (their modules do not exist yet), a module story harness for data-bound panels.
