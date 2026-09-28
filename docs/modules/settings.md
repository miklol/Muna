# Settings window

**Tier P0 · Owner: `muna-ui-engineer` · Status: in progress (M1-E3 landed the window shell and
the M1 panes; remaining panes arrive with their modules)**

## Purpose

Every behaviour in Muna is opt-in and tunable here. Mirrors MacNotch's dark, card-based
settings: left sidebar with search, one pane per module + system panes.

## Reference

`demo-23`, `window-snap` (settings window visible): sidebar with app identity, search field
and nav rows with icons; content cards radius 16, header row (icon · title · count chip ·
chevron), option tiles with check circles. Muna keeps the reference's structure but follows
[05-design-system.md → Settings surfaces](../05-design-system.md) for measurements: sidebar
220 px with 32 px rows and 16 px icons, content max-width 640, rows 44 px with trailing
controls, and the Windows-native title bar rather than the reference's custom pill.

## Panes

General (language, launch at login, hide from captures, sounds, reduced motion, updates) ·
Layout (shape, size, module order, default module) · Multiple Screens (per-monitor cards) ·
Notch positioning (offsets, mode) · Live Activities · Drop Actions · Snap Zones · Shelf ·
Keyboard Shortcuts · Appearance (accent, wallpaper-adaptive tint, Reduce motion, Increase
contrast, Announce notices) · Privacy & Permissions
(notification listener, location, camera) · Integrations (accounts: Microsoft, Google, GitHub,
GitLab, Bitbucket, Jira, Spotify, OpenAI/Ollama) · one pane per module · About & Updates ·
Diagnostics (export bundle, logs).

## Platform

Separate Tauri window with standard decorations; Mica backdrop (`DwmSetWindowAttribute
DWMWA_SYSTEMBACKDROP_TYPE`) is a later polish item. Settings persisted as versioned JSON
(`%APPDATA%\Muna\settings.json`) via a typed schema (zod) with migrations; secrets in Windows
Credential Manager (`CredWrite`).

## Acceptance criteria

- Search filters panes and individual settings by label and synonyms.
- Every toggle applies live (no relaunch) except language.
- Reset per pane and global; export/import settings JSON.
- Keyboard navigable; each control has a label; 4.5:1 text contrast in dark and light; one
  `h1` per pane with `h2` sections; every pane has a Storybook story that passes axe.

## Implementation notes (M5-E3)

Landed by `feat(settings): increase contrast and announce notices switches (m5-e3)` and the
fixes that followed it on the same branch.

- **Settings v7.** `general.contrast: 'system' | 'more'` and `general.announceNotices:
  boolean` (both default to following Windows and staying quiet; a v6 file migrates with the
  defaults). The app mirrors `more` as `data-contrast="more"` on `<html>` in both windows,
  where [tokens.css](../05-design-system.md#colour) already steps hairlines and secondary text
  up, and passes `announceNotices` to the strip, whose `role="status"` region is
  `aria-live="off"` until it is on. Both rows sit in an *Accessibility* section of the
  Appearance pane and are indexed by the settings search.
- **Headings.** The pane title is the `h1`, `Section` titles are `h2`, and `Card` titles
  default to `h2` (`headingLevel={3}` inside a titled section), so axe's `heading-order`
  passes on every pane story.
- **Storybook.** Every pane (General, Layout, Multiple screens, Appearance, Modules, About,
  the onboarding flow and each module pane) has a story with a `PseudoRtl` variant, and the
  Storybook toolbar has a *Contrast* switch that sets `data-contrast`. The manual half is
  [qa/checklists/accessibility](../qa/checklists/accessibility.md).

## Implementation notes (M1-E3)

Landed by `feat(settings): settings window with sidebar, panes and live apply (m1-e3)`.

- **Window.** `apps/desktop/src/settings/`: React Aria `Tabs orientation="vertical"` is the
  sidebar (`TabList` of 32 px rows, one `TabPanel` for the current pane), a `@muna/ui`
  `SearchField` above it, content column `max-width: 640px`. The window follows the Windows
  app theme through `prefers-color-scheme` (`data-theme="light"` on `<html>`); the notch stays
  dark. Native decorations are kept: the design system's Settings spec wins over this spec's
  earlier "custom pill" sentence, which was corrected above.
- **Panes shipped.** General (launch at login, hide from captures, the toggle shortcut as
  read-only key caps), Layout (shape, placement, strip height defaults), Notch position
  (offset sliders with a reset), Multiple screens (one card per monitor from `list_monitors`;
  "Use the defaults" off gives the screen its own `shell.monitors[id]` entry, on deletes it),
  Appearance (accent swatches as a radio group, Reduce motion), Modules (enable and reorder
  from the frontend registry), About and diagnostics (version, platform, data folder, open
  logs folder, export, import, reset all). A module whose `ModuleDefinition.settings` is set
  gets its own `module:<id>` pane, wrapped in `Suspense` so a `lazy` section loads on first
  visit. Language, sounds, updates, keyboard-shortcut editing and the module-specific panes
  wait for their epics.
- **Write path.** `SettingsEditorProvider` applies every change to the TanStack Query cache
  first (all panes and the notch react at once), then calls `update_settings`; slider drags
  coalesce for 150 ms (`SAVE_DEBOUNCE_MS`, IPC coalescing rather than motion) and
  `onChangeEnd` flushes immediately. A refused save shows an inline `role="alert"` message and
  refetches the document Rust holds. `SettingsChanged` is mirrored into the same cache in both
  windows, so an import or Windows refusing autostart shows up without polling.
- **Shape lives under Layout**, next to placement and strip height, because it is a
  per-monitor layout field (`MonitorLayout.shape`) rather than a theme choice; Appearance
  holds accent and motion.
- **Reduce motion is a switch**, not a three-way choice: on writes `reducedMotion: 'on'`, off
  writes `'system'`. The legacy `'off'` value displays as off and behaves like `system`, since
  [06-motion-spec.md → Reduced motion](../06-motion-spec.md#reduced-motion) says the app
  setting can only add to the OS preference.
- **Module order and visibility** are `shell.moduleOrder` / `shell.disabledModules`
  (settings v3, migrated from v2 with empty lists). The notch reads them from the same cache
  and persists a drag or `Ctrl+Arrow` reorder through `update_settings`.
- **Rust side.** New commands `list_monitors`, `export_settings` (native save dialog, pretty
  JSON), `import_settings` (open dialog → `Settings::from_json` → save → `SettingsChanged`)
  and `open_logs_folder`, using `tauri-plugin-dialog` and `tauri-plugin-opener`; the dialogs
  run in Rust so the UI never touches the file system. `PlatformError` maps to
  `platform.unsupported | os | notFound | accessDenied` IPC codes.
- **Tests.** Vitest covers the window (navigation, search narrowing and empty state, every
  pane's writes, refused save, `SettingsChanged` mirroring, error state), the editor (debounce,
  flush, refused save), the search index, the appearance hooks and the notch's module order
  and disabled set; Rust covers the v3 migration and the new IPC error mapping. The Playwright
  pane flows named in the build plan are deferred until the e2e harness exists
  ([09-testing-qa.md](../09-testing-qa.md)).

## Implementation notes (M1-E5)

Landed by `feat(onboarding): first-run welcome tour in the settings window (m1-e5)`.

- **Where it lives.** The tour is part of the settings window
  (`apps/desktop/src/settings/onboarding/`), not a third window: `SettingsApp` renders
  `OnboardingFlow` instead of the sidebar and panes while `general.onboarded` is false or the
  user asked for it again. Rust already opens the settings window on first run, so the tour
  is the first thing a new profile sees.
- **Settings v4.** `general.onboarded: boolean`. New profiles start at `false`; a v3 file
  migrates to `true`, since whoever wrote it has used the app already. Skip and Finish both
  write `true` (a skipped tour must not come back on the next launch). Reset all keeps the
  flag — a reset is not a first run. `CURRENT_VERSION` (Rust) and `SETTINGS_VERSION`
  (contracts) moved together.
- **Steps.** Welcome, Choose your screens, Choose how it sits (Overlay / Reserved), Pick a
  shape (Notch / Island), What Muna will ask for, Start with Windows, All set — one 560 × 420
  card on `--surface-1`, radius 12, padding 24, with "Step n of m" and Skip in the header and
  Back / Continue (Finish on the last step) in the footer. Every choice goes through
  `SettingsEditorProvider.update`, so the notch previews it at once and Multiple screens,
  Layout and General show the same values afterwards.
- **Screens step** is left out with one screen — there is nothing to choose — and when the
  list fails; while it loads the step stays in, so the count does not jump. Turning a screen
  off gives it its own `shell.monitors[id]` entry with `enabled: false`; turning it back on
  drops the entry when it equals the defaults, so Multiple screens shows "Use the defaults".
- **Placement explainer** is state-driven: `PlacementArt` draws a 240 × 120 screen from
  tokens with a title bar and the strip; choosing Reserved moves the window down by the strip
  height on the `layout` spring and Overlay lifts the strip to its 3 px line on the `reveal`
  spring. Transform-only (`y`), no timers, and reduced motion gets the same end states.
- **Shape tiles** reuse `NotchSurface` for their art, so the tour shows the real corner
  geometry. `OptionTiles` (`@muna/ui`) is the new primitive: a React Aria radio group of
  tiles named by their title and described by their description, with the illustration
  hidden from assistive technology.
- **Permissions are informational.** Nothing is requested in the tour; each module asks the
  first time it needs Bluetooth, notifications or the camera.
- **Step changes** use the content recipe from the motion spec (`enterFromLarge` → `visible`,
  `content` spring after `moduleSwitchEnterDelayMs`, `contentExitTransition` out) inside an
  `AnimatePresence mode="popLayout"`. After Back or Continue focus moves to the new step's
  heading so the change is announced; opening the tour does not steal focus.
- **Tests.** Vitest: `onboardingSteps` (loading, two screens, one screen, failed list), the
  walk through every step with the counter and focus handoff, each step's writes (screens
  override and its removal, placement + caption, shape, launch at login), Finish and Skip
  marking the tour seen and handing back, no second save for a profile that has seen it, and
  the `SettingsApp` gate (tour until onboarded, General → Show again). Rust: v3 → v4
  migration and the new default.
- **Deferred.** Mica backdrop, per-pane reset (only "Reset all settings" exists), hotkey
  editing. The diagnostics bundle lives in Settings → Support since M5-E1a
  ([support](support.md)); About keeps *Open logs folder*.
