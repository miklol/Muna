import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { DropActionsIcon } from './drop-actions-icon';
import { DropSurface } from './drop-surface';

/** Settings › Drop actions loads on first visit so the notch bundle stays small. */
const DropActionsSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.DropActionsSettingsPane })),
);

/**
 * The drop actions module's frontend half (docs/modules/drop-actions.md; ADR-0004). Its Rust
 * half is `src-tauri/src/modules/drop_actions`, which watches the drag, keeps the items and
 * runs the file operations; the id is the settings namespace both sides read. It has no panel:
 * the tile row is the shell's `drop` state, which mounts `drop` for the drag, and the tiles,
 * folders and layout are edited in its settings pane. Disabling the module in Settings › Modules
 * turns drops off.
 */
export const dropActionsModule: ModuleDefinition = {
  id: 'drop-actions',
  titleKey: 'dropActions.title',
  icon: DropActionsIcon,
  settings: DropActionsSettings,
  drop: DropSurface,
};
