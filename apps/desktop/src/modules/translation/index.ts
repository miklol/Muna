import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { TranslationPanel } from './panel';
import { TranslationIcon } from './translation-icon';
import { useTranslationStore } from './translation-store';
import { TranslationWidget } from './widget';

/** Settings → Translation loads on first visit so the notch bundle stays small. */
const TranslationSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.TranslationSettingsPane })),
);

/**
 * The translation module's frontend half (docs/modules/translation.md; ADR-0004). Its Rust half
 * is `src-tauri/src/modules/translation`; the id is the settings namespace both sides read.
 * The request, the streaming and the key live in Rust; the panel sends text and renders the
 * chunks that come back. One action: open the panel with the caret in the source box, for a
 * hotkey or the palette.
 */
export const translationModule: ModuleDefinition = {
  id: 'translation',
  titleKey: 'translation.title',
  icon: TranslationIcon,
  panel: TranslationPanel,
  widget: TranslationWidget,
  settings: TranslationSettings,
  actions: [
    {
      id: 'translation.translate',
      labelKey: 'translation.actions.translateText',
      run: ({ openModule }) => {
        useTranslationStore.getState().requestFocus();
        openModule('translation');
      },
    },
  ],
};
