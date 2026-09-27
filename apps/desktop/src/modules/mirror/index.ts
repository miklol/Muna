import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { MirrorIcon } from './mirror-icon';
import { MirrorPanel } from './panel';
import { MirrorWidget } from './widget';

/** Settings → Mirror loads on first visit so the notch bundle stays small. */
const MirrorSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.MirrorSettingsPane })),
);

/**
 * The mirror module's frontend half (docs/modules/mirror.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/mirror`; the id is the settings namespace both sides read. The
 * camera is the webview's: the panel and the widget open it through `getUserMedia` while they
 * are mounted, Rust decides whether the request is allowed and keeps the renderer's memory
 * target normal while a preview runs. No action: there is nothing to do without the picture.
 */
export const mirrorModule: ModuleDefinition = {
  id: 'mirror',
  titleKey: 'mirror.title',
  icon: MirrorIcon,
  panel: MirrorPanel,
  widget: MirrorWidget,
  settings: MirrorSettings,
};
