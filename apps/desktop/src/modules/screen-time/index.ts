import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { ScreenTimePanel } from './panel';
import { ScreenTimeIcon } from './screen-time-icon';
import { ScreenTimeWidget } from './widget';

/** Settings → Screen time loads on first visit so the notch bundle stays small. */
const ScreenTimeSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.ScreenTimeSettingsPane })),
);

/**
 * The screen time module's frontend half (docs/modules/screen-time.md; ADR-0004). Its Rust
 * half is `src-tauri/src/modules/screen_time`; the id is the settings namespace both sides
 * read. Everything shown is a snapshot Rust publishes while a window watches; the UI keeps no
 * timer of its own.
 */
export const screenTimeModule: ModuleDefinition = {
  id: 'screen-time',
  titleKey: 'screenTime.title',
  icon: ScreenTimeIcon,
  panel: ScreenTimePanel,
  widget: ScreenTimeWidget,
  settings: ScreenTimeSettings,
};
