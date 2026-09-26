import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { BluetoothIcon } from './bluetooth-icon';
import { BluetoothPanel } from './panel';
import { BluetoothWidget } from './widget';

/** Settings → Bluetooth loads on first visit so the notch bundle stays small. */
const BluetoothSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.BluetoothSettingsPane })),
);

/**
 * The Bluetooth module's frontend half (docs/modules/bluetooth.md; ADR-0004). Its Rust half
 * is `src-tauri/src/modules/bluetooth`; the id is the settings namespace both sides read.
 */
export const bluetoothModule: ModuleDefinition = {
  id: 'bluetooth',
  titleKey: 'bluetooth.title',
  icon: BluetoothIcon,
  panel: BluetoothPanel,
  widget: BluetoothWidget,
  settings: BluetoothSettings,
};
