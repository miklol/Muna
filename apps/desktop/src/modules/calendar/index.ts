import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { CalendarIcon } from './calendar-icon';
import { CalendarPanel } from './panel';
import { CalendarWidget } from './widget';

/** Settings → Calendar loads on first visit so the notch bundle stays small. */
const CalendarSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.CalendarSettingsPane })),
);

/**
 * The calendar module's frontend half (docs/modules/calendar.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/calendar`; the id is the settings namespace both sides read.
 */
export const calendarModule: ModuleDefinition = {
  id: 'calendar',
  titleKey: 'calendar.title',
  icon: CalendarIcon,
  panel: CalendarPanel,
  widget: CalendarWidget,
  settings: CalendarSettings,
};
