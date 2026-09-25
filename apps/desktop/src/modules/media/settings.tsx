import {
  commands,
  defaultMediaSettings,
  type MediaSettings,
  readMediaSettings,
  type Visualiser,
  writeMediaSettings,
} from '@muna/contracts';
import { Button, type SegmentedControlItem } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import { ActionRow, Section, SegmentedRow, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { useMediaStore } from './media-store';
import { appDisplayName } from './progress';
import { useMediaSubscription } from './use-media';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/** The value the preferred-app control shows for "follow the scoring". */
const AUTO = 'auto';

/**
 * Preferred app choices: Auto plus every app with a session right now, plus the saved one even
 * when it is closed so the user can see (and clear) it.
 */
export const preferredAppItems = (
  known: readonly string[],
  preferred: string | null,
  autoLabel: string,
): SegmentedControlItem[] => {
  const ids = [...new Set([...known, ...(preferred === null ? [] : [preferred])])].sort();
  return [{ id: AUTO, label: autoLabel }, ...ids.map((id) => ({ id, label: appDisplayName(id) }))];
};

/**
 * Settings → Media (docs/modules/media.md "Settings"): preferred app, adaptive colours and
 * the visualiser. Writes go through the shared editor so they save like any other setting and
 * reach Rust, which re-pins and republishes the strip.
 */
export function MediaSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  useMediaSubscription();
  const state = useMediaStore((store) => store.state);
  const media = readMediaSettings(settings);

  const write = (recipe: (current: MediaSettings) => MediaSettings) => {
    update((current) => {
      const now = readMediaSettings(current);
      return writeMediaSettings(current, recipe(now));
    });
  };

  const sessions = state?.sessions.map((session) => session.sourceAppId) ?? [];
  const visualiserItems: SegmentedControlItem<Visualiser>[] = [
    { id: 'bars', label: t('media.settings.visualiserBars') },
    { id: 'off', label: t('media.settings.visualiserOff') },
  ];

  return (
    <>
      <Section
        title={t('media.settings.source')}
        visible={everything}
        rows={[
          {
            id: 'media.preferredApp',
            node: (
              <SegmentedRow
                label={t('media.settings.preferredApp')}
                description={t('media.settings.preferredAppBody')}
                items={preferredAppItems(sessions, media.preferredApp, t('media.settings.auto'))}
                value={media.preferredApp ?? AUTO}
                onChange={(value) => {
                  write((current) => ({
                    ...current,
                    preferredApp: value === AUTO ? null : value,
                  }));
                }}
              />
            ),
          },
          {
            id: 'media.refresh',
            node: (
              <ActionRow
                label={t('media.settings.refresh')}
                description={t('media.settings.refreshBody')}
                action={
                  <Button
                    onPress={() => {
                      void commands.mediaRefresh().catch(() => {
                        // Nothing to show: the next state event carries whatever changed.
                      });
                    }}
                  >
                    {t('media.settings.refreshAction')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
      <Section
        title={t('media.settings.look')}
        visible={everything}
        rows={[
          {
            id: 'media.adaptiveColours',
            node: (
              <ToggleRow
                label={t('media.settings.adaptiveColours')}
                description={t('media.settings.adaptiveColoursBody')}
                isSelected={media.adaptiveColours}
                onChange={(adaptiveColours) => {
                  write((current) => ({ ...current, adaptiveColours }));
                }}
              />
            ),
          },
          {
            id: 'media.visualiser',
            node: (
              <SegmentedRow
                label={t('media.settings.visualiser')}
                description={t('media.settings.visualiserBody')}
                items={visualiserItems}
                value={media.visualiser}
                onChange={(visualiser) => {
                  write((current) => ({ ...current, visualiser }));
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}

/** What a fresh document reads as, for tests and stories. */
export const mediaDefaults = defaultMediaSettings;
