import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { SnapSurface } from './snap-surface';
import { WindowSnapIcon } from './window-snap-icon';

/** Settings › Window snap loads on first visit so the notch bundle stays small. */
const WindowSnapSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.WindowSnapSettingsPane })),
);

/**
 * The window snap module's frontend half (docs/modules/window-snap.md; ADR-0004). Its Rust
 * half is `src-tauri/src/modules/window_snap`, which tracks the drag through the shell, works
 * out the zone geometry and places the window; the id is the settings namespace both sides
 * read. It has no panel: the zones are the shell's `snap` state, which mounts `snap` for the
 * drag, and the zones and grid are chosen in its settings pane. Disabling the module in
 * Settings › Modules turns snapping off on both sides.
 */
export const windowSnapModule: ModuleDefinition = {
  id: 'window-snap',
  titleKey: 'windowSnap.title',
  icon: WindowSnapIcon,
  settings: WindowSnapSettings,
  snap: SnapSurface,
};
