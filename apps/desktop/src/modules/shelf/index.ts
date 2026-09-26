import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { ShelfPanel } from './panel';
import { ShelfIcon } from './shelf-icon';

/** Settings → Shelf loads on first visit so the notch bundle stays small. */
const ShelfSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.ShelfSettingsPane })),
);

/**
 * The Shelf's frontend half (docs/modules/shelf.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/shelf`; the id is the settings namespace both sides read. Items
 * arrive through the drop row's *Shelf* tile (drop-actions hands them over in Rust) and the
 * panel's paste field; they leave by drag-out, copy or removal.
 */
export const shelfModule: ModuleDefinition = {
  id: 'shelf',
  titleKey: 'shelf.title',
  icon: ShelfIcon,
  panel: ShelfPanel,
  settings: ShelfSettings,
};
