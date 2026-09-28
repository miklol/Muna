import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { HudIcon } from './hud-icon';

/** Settings → Volume and brightness loads on first visit so the notch bundle stays small. */
const HudSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.HudSettingsPane })),
);

/**
 * The HUD module's frontend half (docs/modules/hud.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/hud`; the id is the settings namespace both sides read. The HUD has
 * no panel: it shows in the strip as a notice and configures itself from its settings pane.
 */
export const hudModule: ModuleDefinition = {
  id: 'hud',
  titleKey: 'hud.title',
  icon: HudIcon,
  settings: HudSettings,
};
