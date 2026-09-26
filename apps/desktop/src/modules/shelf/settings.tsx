import {
  defaultShelfSettings,
  readShelfSettings,
  SHELF_EXPIRY_CHOICES,
  type ShelfSettings,
  writeShelfSettings,
} from '@muna/contracts';
import { Button, type SegmentedControlItem } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import { ActionRow, SegmentedRow, Section, ToggleRow, ValueRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { useShelfStore } from './shelf-store';
import { useShelfCommand, useShelfSubscription } from './use-shelf';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/**
 * Settings → Shelf (docs/modules/shelf.md): whether dropped files are copied into Shelf storage
 * or referenced, when items expire, and a way to clear the Shelf. Setting writes go through the
 * shared editor so they save like any other setting and reach Rust, which applies them at once.
 */
export function ShelfSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const shelf = readShelfSettings(settings);
  useShelfSubscription();
  const snapshot = useShelfStore((store) => store.snapshot);
  const send = useShelfCommand();
  const count = snapshot?.items.length ?? 0;

  const write = (recipe: (current: ShelfSettings) => ShelfSettings) => {
    update((current) => writeShelfSettings(current, recipe(readShelfSettings(current))));
  };
  // A hand-edited value outside the offered choices still shows as its own segment.
  const choices = SHELF_EXPIRY_CHOICES.includes(shelf.expiryDays)
    ? SHELF_EXPIRY_CHOICES
    : [...SHELF_EXPIRY_CHOICES, shelf.expiryDays].sort((a, b) => a - b);
  const expiryItems: SegmentedControlItem[] = choices.map((days) => ({
    id: String(days),
    label: days === 0 ? t('shelf.settings.never') : t('shelf.settings.days', { count: days }),
  }));

  return (
    <>
      <Section
        title={t('shelf.settings.storage')}
        visible={everything}
        rows={[
          {
            id: 'shelf.copyIntoStorage',
            node: (
              <ToggleRow
                label={t('shelf.settings.copyIntoStorage')}
                description={t('shelf.settings.copyIntoStorageBody')}
                isSelected={shelf.copyIntoStorage}
                onChange={(copyIntoStorage) => {
                  write((current) => ({ ...current, copyIntoStorage }));
                }}
              />
            ),
          },
          {
            id: 'shelf.expiryDays',
            node: (
              <SegmentedRow
                label={t('shelf.settings.expiry')}
                description={t('shelf.settings.expiryBody')}
                items={expiryItems}
                value={String(shelf.expiryDays)}
                onChange={(value) => {
                  const expiryDays = Number(value);
                  write((current) => ({ ...current, expiryDays }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('shelf.settings.items')}
        visible={everything}
        rows={[
          {
            id: 'shelf.count',
            node: (
              <ValueRow label={t('shelf.settings.count')} value={t('shelf.items', { count })} />
            ),
          },
          {
            id: 'shelf.clear',
            node: (
              <ActionRow
                label={t('shelf.settings.clear')}
                description={t('shelf.settings.clearBody')}
                action={
                  <Button
                    variant="destructive"
                    isDisabled={count === 0}
                    onPress={() => {
                      void send({ kind: 'clear' });
                    }}
                  >
                    {t('shelf.settings.clearAction')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
    </>
  );
}

/** What a fresh document reads as, for tests and stories. */
export const shelfDefaults = defaultShelfSettings;
