import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { PomodoroPanel } from './panel';
import { PomodoroWidget } from './widget';
import { PomodoroIcon } from './pomodoro-icon';

/** Settings → Pomodoro loads on first visit so the notch bundle stays small. */
const PomodoroSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.PomodoroSettingsPane })),
);

/**
 * The pomodoro module's frontend half (docs/modules/pomodoro.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/pomodoro`; the id is the settings namespace both sides read.
 */
export const pomodoroModule: ModuleDefinition = {
  id: 'pomodoro',
  titleKey: 'pomodoro.title',
  icon: PomodoroIcon,
  panel: PomodoroPanel,
  widget: PomodoroWidget,
  settings: PomodoroSettings,
};
