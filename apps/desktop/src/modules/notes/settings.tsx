import { type NotesSettings, readNotesSettings, writeNotesSettings } from '@muna/contracts';
import { Button, ListRow, Text } from '@muna/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionRow, Section } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { useNotesStore } from './notes-store';
import { pickNotesFolder, revealFolder, useNotesSubscription } from './use-notes';
import './notes-settings.css';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/**
 * Settings → Notes (docs/modules/notes.md): the folder the notes live in — the default under
 * the profile, or any folder the user picks, an Obsidian vault included — with *Change*, *Use
 * the default folder* and *Open folder*; then what the quick note does and where its shortcut
 * is set. The folder itself is written into the settings document; Rust follows it.
 */
export function NotesSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  useNotesSubscription();
  const snapshot = useNotesStore((store) => store.snapshot);
  const notes = readNotesSettings(settings);
  const [picking, setPicking] = useState(false);

  const write = (recipe: (current: NotesSettings) => NotesSettings) => {
    update((current) => writeNotesSettings(current, recipe(readNotesSettings(current))));
  };

  const pick = () => {
    setPicking(true);
    void pickNotesFolder(t('notes.settings.pickTitle'))
      .then((path) => {
        if (path !== null) write((current) => ({ ...current, folder: path }));
      })
      .finally(() => {
        setPicking(false);
      });
  };

  // The folder in use comes from Rust (the default lives under the profile, unknown here).
  const folder = notes.folder ?? snapshot?.folder ?? null;
  const usingDefault = notes.folder === null;
  const missing = snapshot?.problem === 'missing' && !usingDefault;
  const defaultWords = t('notes.settings.defaultFolder');
  let folderDescription: string;
  if (folder === null || folder === '') folderDescription = defaultWords;
  else if (usingDefault) folderDescription = `${defaultWords} · ${folder}`;
  else folderDescription = folder;

  return (
    <>
      <Section
        title={t('notes.settings.section')}
        description={t('notes.settings.folderBody')}
        visible={everything}
        rows={[
          {
            id: 'notes.folder',
            node: (
              <div className="notes-folder">
                <ActionRow
                  label={t('notes.settings.folder')}
                  description={folderDescription}
                  action={
                    <span className="notes-folder__actions">
                      <Button variant="secondary" isDisabled={picking} onPress={pick}>
                        {t('notes.settings.change')}
                      </Button>
                      <Button
                        variant="secondary"
                        onPress={() => {
                          void revealFolder();
                        }}
                      >
                        {t('notes.settings.openFolder')}
                      </Button>
                    </span>
                  }
                />
                {!usingDefault && (
                  <div className="notes-folder__foot">
                    {missing && (
                      <Text
                        as="p"
                        variant="footnote"
                        tone="secondary"
                        className="notes-folder__note"
                      >
                        {t('notes.settings.missing')}
                      </Text>
                    )}
                    <Button
                      variant="secondary"
                      onPress={() => {
                        write((current) => ({ ...current, folder: null }));
                      }}
                    >
                      {t('notes.settings.useDefault')}
                    </Button>
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
      <Section
        title={t('notes.settings.quickNote')}
        visible={everything}
        rows={[
          {
            id: 'notes.quickNote',
            node: (
              <ListRow
                label={t('notes.actions.quickNote')}
                description={t('notes.settings.quickNoteBody')}
              />
            ),
          },
        ]}
      />
    </>
  );
}
