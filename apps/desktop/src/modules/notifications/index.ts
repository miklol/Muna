import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { NotificationsIcon } from './notifications-icon';
import { NotificationsPanel } from './panel';

/** Settings → Notifications loads on first visit so the notch bundle stays small. */
const NotificationsSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.NotificationsSettingsPane })),
);

/**
 * The notifications module's frontend half (docs/modules/notifications.md; ADR-0004). Its
 * Rust half is `src-tauri/src/modules/notifications`; the id is the settings namespace both
 * sides read.
 */
export const notificationsModule: ModuleDefinition = {
  id: 'notifications',
  titleKey: 'notifications.title',
  icon: NotificationsIcon,
  panel: NotificationsPanel,
  settings: NotificationsSettings,
};
