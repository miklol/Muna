# Keyboard shortcuts

**Tier P1 · Owner: `muna-shell-engineer` · Status: implemented (M4-E6; quick note waits for
Notes (M4-E7), the HUD keyboard-hook fallback is not built — see
[Implementation notes](#implementation-notes-m4-e6))**

## Scope

Global hotkeys: toggle panel (`Ctrl+Alt+Space`), snooze notch (`Ctrl+Alt+N`, duration 15/30/60
min), next/previous module, open module *N*, quick add task, quick note, toggle Pomodoro,
media play/pause (optional, complements media keys). "Only when hovering" scope option.

## Platform

`RegisterHotKey` per binding (conflicts reported inline); recorder UI captures chords via
`keydown` in the Settings window; persisted as `{ mods, vk }`. No low-level keyboard hook
except the optional HUD fallback.

## Acceptance criteria

- Conflicting chord with another app → red "In use" state, binding not saved.
- Hotkeys work while a fullscreen borderless game is focused (RegisterHotKey does).

## Implementation notes (M4-E6)

Everything a shortcut can do is an **action** with a stable id, and every binding is a row
`action id → chord` in the module's settings namespace
(`settings.modules["keyboard-shortcuts"].bindings`; settings v5 moved `shell.toggleHotkey`
there as `shell.togglePanel`). Pieces, in the order a press flows:

- **Chords** are `tauri-plugin-global-shortcut` strings (`ctrl+alt+space`), normalised on both
  sides (`normalise_chord` in Rust, `normaliseChord` in `@muna/contracts`): lower-case, no
  spaces, so `Ctrl + Alt + Space` and `ctrl+alt+space` are one binding. Persisting the plugin's
  syntax rather than `{ mods, vk }` keeps the file readable and the recorder and Rust in
  agreement; the recorder (`modules/keyboard-shortcuts/chord.ts`) builds the token from
  `KeyboardEvent.code` (`KeyA→a`, `Digit1→1`, `Numpad7→num7`, modifiers in the order ctrl, alt,
  shift, super). Function keys may stand alone; anything else needs Ctrl, Alt or Win; media
  keys, lock keys and IME keys cannot be bound.
- **Service** (`src-tauri/src/modules/keyboard_shortcuts`): Tauri-free `HotkeyService` behind
  a `HotkeyRegistrar` (the binary wires the plugin, `RegisterHotKey` with `MOD_NOREPEAT`; tests
  script a fake that "holds" chords) and a `HotkeySink`. `apply_settings` diffs the wanted
  bindings against the registered ones at start-up and on every settings change. A chord the
  OS refuses **stays in the file** with state `inUse` so the pane can show it and the next
  launch tries again (the other app may be gone); a chord the plugin cannot parse is `invalid`.
- **Recording** goes through `set_hotkey(action, chord)`: the service registers with the OS
  first and only then writes the document, so a conflict comes back as `hotkey.inUse` (or
  `hotkey.taken` when one of our own actions already holds the chord) and the previous binding
  is restored — the acceptance criterion "binding not saved". `clear_hotkey` unbinds;
  `get_hotkeys` lists every binding with its state.
- **Presses**: Rust resolves the chord to its action id and checks the *only while hovering*
  scope against the shell's last cursor sample. `shell.snooze` is handled in Rust (the notch
  under the cursor parks for the configured 15/30/60 min); every other action is emitted as
  `HotkeyPressed { action, label }` — `label` is the notch on the monitor under the cursor —
  and resolved in the UI (`shell/actions.ts`): the shell's own actions (`shell.togglePanel`,
  `shell.palette`, `shell.nextModule`, `shell.previousModule`, `shell.openModule.1`–`.9`) or a
  module action from the registry (`ModuleDefinition.actions`: `todo.quickAdd`,
  `pomodoro.toggle`, `media.playPause`). `HotkeyPressed` replaces M1's `ShellToggleRequested`
  (pre-1.0 breaking change; the only consumer was the shell).
- **Command palette** (`shell/palette.tsx`, `shell.palette`, default `Ctrl+Shift+Space`): a
  search field over every runnable action grouped by owner, rendered in place of the module
  body with the bound chords as caps. Arrow keys move a virtual focus from the field (React
  Aria `Autocomplete`), Enter runs, Esc clears the query and, once empty, closes the panel
  like anywhere else in the shell. `shell.snooze` is not listed (it is only meaningful as a
  hotkey).
- **Settings pane**: the shell's actions, the open-by-number rows, one group per module with
  actions, then the two options (*only while hovering*, snooze length). Each row is a recorder
  button: press → "Press a shortcut" → the next chord binds; Esc keeps the old one, Backspace
  clears. Refusals read beside the row (`In use by another app`, `Already used by …`, `Add
  Ctrl, Alt or Win`, `That key cannot be bound`).
- **Deferred**: quick note (no Notes module until M4-E7), the low-level keyboard-hook fallback
  for the HUD (docs/04 lists it as optional; nothing needs it yet), and per-app scoping.
- **Tests**: `tests/keyboard_shortcuts.rs` (fake registrar: a refused chord stays in the file
  as *in use* and is retried on the next apply, `try_bind` registers first and restores the
  previous binding on refusal, a press reaches the sink with the settings in force),
  `packages/contracts` schema round-trips, Vitest for the chord recorder, the actions resolver,
  the palette, the pane and the machine's `open` event; the pane and palette states are
  Storybook stories under `apps/desktop`. The snooze and hover-scope branches of the Tauri
  sink (`ipc.rs`) are checked by hand in the shell checklist.
