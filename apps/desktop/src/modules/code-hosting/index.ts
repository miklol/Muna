import { commands } from '@muna/contracts';
import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { CodeHostingIcon } from './code-hosting-icon';
import { CodeHostingPanel } from './panel';
import { CodeHostingWidget } from './widget';

/** Settings → Code hosting loads on first visit so the notch bundle stays small. */
const CodeHostingSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.CodeHostingSettingsPane })),
);

/**
 * The code-hosting module's frontend half (docs/modules/code-hosting.md; ADR-0004). Its Rust
 * half is `src-tauri/src/modules/code_hosting`; the id is the settings namespace both sides
 * read. The token never reaches this side: it goes to Rust once from the settings pane.
 */
export const codeHostingModule: ModuleDefinition = {
  id: 'code-hosting',
  titleKey: 'codeHosting.title',
  icon: CodeHostingIcon,
  panel: CodeHostingPanel,
  widget: CodeHostingWidget,
  settings: CodeHostingSettings,
  actions: [
    {
      id: 'code-hosting.refresh',
      labelKey: 'codeHosting.actions.refresh',
      run: ({ openModule }) => {
        openModule('code-hosting');
        void commands.codeHostingCommand({ kind: 'refresh' }).catch(() => {
          // Not running inside Tauri: nothing to poll.
        });
      },
    },
  ],
};
