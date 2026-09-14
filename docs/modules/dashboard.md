# Dashboard

**Tier P1 · Owner: `muna-module-developer` · Status: spec**

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
