import { commands } from '@muna/contracts';
import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { MediaIcon } from './media-icon';
import { MediaPanel } from './panel';
import { MediaWidget } from './widget';

/** Settings → Media loads on first visit so the notch bundle stays small. */
const MediaSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.MediaSettingsPane })),
);

/**
 * The media module's frontend half (docs/modules/media.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/media`; the id is the settings namespace both sides read. Its one
 * action, "Play or pause", drives the active session without opening the notch.
 */
export const mediaModule: ModuleDefinition = {
  id: 'media',
  titleKey: 'media.title',
  icon: MediaIcon,
  panel: MediaPanel,
  widget: MediaWidget,
  settings: MediaSettings,
  actions: [
    {
      id: 'media.playPause',
      labelKey: 'media.actions.playPause',
      run: () => {
        void commands.mediaCommand(null, { kind: 'togglePlayPause' }).catch(() => {
          // Not running inside Tauri: nothing to drive.
        });
      },
    },
  ],
};
