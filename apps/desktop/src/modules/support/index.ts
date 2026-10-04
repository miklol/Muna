import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { SupportPanel } from './panel';
import { SupportIcon } from './support-icon';

/** Settings → Support loads on first visit so the notch bundle stays small. */
const SupportSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.SupportSettingsPane })),
);

/**
 * The support module's frontend half (docs/modules/support.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/support`; the id is the settings namespace both sides read. No widget:
 * nothing here is worth a glance, and the panel is one list.
 */
export const supportModule: ModuleDefinition = {
  id: 'support',
  titleKey: 'support.title',
  icon: SupportIcon,
  panel: SupportPanel,
  settings: SupportSettings,
};
