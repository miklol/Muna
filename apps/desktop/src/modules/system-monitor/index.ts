import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { SystemMonitorPanel } from './panel';
import { SystemMonitorWidget } from './widget';
import { SystemMonitorIcon } from './system-monitor-icon';

/** Settings → System loads on first visit so the notch bundle stays small. */
const SystemMonitorSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.SystemMonitorSettingsPane })),
);

/**
 * The system monitor's frontend half (docs/modules/system-monitor.md; ADR-0004). Its Rust
 * half is `src-tauri/src/modules/system_monitor`; the id is the settings namespace both sides
 * read.
 */
export const systemMonitorModule: ModuleDefinition = {
  id: 'system-monitor',
  titleKey: 'systemMonitor.title',
  icon: SystemMonitorIcon,
  panel: SystemMonitorPanel,
  widget: SystemMonitorWidget,
  settings: SystemMonitorSettings,
};
