import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { DashboardIcon } from './dashboard-icon';
import { DashboardPanel } from './panel';

/** Settings → Dashboard loads on first visit so the notch bundle stays small. */
const DashboardSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.DashboardSettingsPane })),
);

/**
 * The dashboard module's frontend half (docs/modules/dashboard.md; ADR-0004): the widget grid
 * that composes the other modules' `widget` components through the registry. Its Rust half is
 * `src-tauri/src/modules/dashboard`, which owns the settings namespace; the id is the namespace
 * both sides read. It has no widget of its own.
 */
export const dashboardModule: ModuleDefinition = {
  id: 'dashboard',
  titleKey: 'dashboard.title',
  icon: DashboardIcon,
  panel: DashboardPanel,
  settings: DashboardSettings,
};
