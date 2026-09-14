# Keyboard shortcuts

**Tier P1 · Owner: `muna-shell-engineer` · Status: spec**

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
