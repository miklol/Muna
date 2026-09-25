import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { WeatherPanel } from './panel';
import { WeatherIcon } from './weather-icon';

/** Settings → Weather loads on first visit so the notch bundle stays small. */
const WeatherSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.WeatherSettingsPane })),
);

/**
 * The weather module's frontend half (docs/modules/weather.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/weather`; the id is the settings namespace both sides read.
 */
export const weatherModule: ModuleDefinition = {
  id: 'weather',
  titleKey: 'weather.title',
  icon: WeatherIcon,
  panel: WeatherPanel,
  settings: WeatherSettings,
};
