import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { KeyboardShortcutsIcon } from './keyboard-shortcuts-icon';

/** Settings › Keyboard shortcuts loads on first visit so the notch bundle stays small. */
const KeyboardShortcutsSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.KeyboardShortcutsSettingsPane })),
);

/**
 * The keyboard shortcuts module's frontend half (docs/modules/keyboard-shortcuts.md;
 * ADR-0004). Its Rust half is `src-tauri/src/modules/keyboard_shortcuts`, which registers the
 * chords with the OS; the id is the settings namespace both sides read. Like the HUD it has no
 * panel: the command palette is a shell surface (`src/shell/palette.tsx`) and the bindings are
 * edited in its settings pane.
 */
export const keyboardShortcutsModule: ModuleDefinition = {
  id: 'keyboard-shortcuts',
  titleKey: 'shortcuts.title',
  icon: KeyboardShortcutsIcon,
  settings: KeyboardShortcutsSettings,
};
