import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { DayProgressIcon } from './day-progress-icon';
import { DayProgressPanel } from './panel';

/** Settings → Day loads on first visit so the notch bundle stays small. */
const DayProgressSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.DayProgressSettingsPane })),
);

/**
 * The day-progress module's frontend half (docs/modules/day-progress.md; ADR-0004). Its Rust
 * half is `src-tauri/src/modules/day_progress`; the id is the settings namespace both sides
 * read.
 */
export const dayProgressModule: ModuleDefinition = {
  id: 'day-progress',
  titleKey: 'dayProgress.title',
  icon: DayProgressIcon,
  panel: DayProgressPanel,
  settings: DayProgressSettings,
};
