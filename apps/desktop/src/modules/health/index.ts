import { commands } from '@muna/contracts';
import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { HealthIcon } from './health-icon';
import { HealthPanel } from './panel';
import { HealthWidget } from './widget';

/** Settings → Health loads on first visit so the notch bundle stays small. */
const HealthSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.HealthSettingsPane })),
);

const quietly = () => {
  // Not running inside Tauri: nothing to drive.
};

/**
 * The health module's frontend half (docs/modules/health.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/health`; the id is the settings namespace both sides read. Two
 * actions work without opening the notch (keyboard-shortcuts): log a glass of water, and
 * start a breathing exercise — which opens the panel so the circle is on screen.
 */
export const healthModule: ModuleDefinition = {
  id: 'health',
  titleKey: 'health.title',
  icon: HealthIcon,
  panel: HealthPanel,
  widget: HealthWidget,
  settings: HealthSettings,
  actions: [
    {
      id: 'health.water',
      labelKey: 'health.actions.water',
      run: () => {
        void commands.healthCommand({ kind: 'water', delta: 1 }).catch(quietly);
      },
    },
    {
      id: 'health.breathe',
      labelKey: 'health.actions.breathe',
      run: (context) => {
        context.openModule('health');
        void commands.healthCommand({ kind: 'startFlow', flow: 'breathe' }).catch(quietly);
      },
    },
  ],
};
