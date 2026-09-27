import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { NotesIcon } from './notes-icon';
import { useNotesStore } from './notes-store';
import { NotesPanel } from './panel';
import { NotesWidget } from './widget';

/** Settings → Notes loads on first visit so the notch bundle stays small. */
const NotesSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.NotesSettingsPane })),
);

/**
 * The notes module's frontend half (docs/modules/notes.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/notes`; the id is the settings namespace both sides read. The files
 * never reach this side whole: the panel asks for one note at a time.
 */
export const notesModule: ModuleDefinition = {
  id: 'notes',
  titleKey: 'notes.title',
  icon: NotesIcon,
  panel: NotesPanel,
  widget: NotesWidget,
  settings: NotesSettings,
  actions: [
    {
      id: 'notes.quickNote',
      labelKey: 'notes.actions.quickNote',
      run: ({ openModule }) => {
        useNotesStore.getState().requestQuickNote();
        openModule('notes');
      },
    },
  ],
};
