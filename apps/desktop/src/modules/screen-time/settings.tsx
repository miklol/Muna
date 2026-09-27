import {
  readScreenTimeSettings,
  SCREEN_TIME_BOUNDS,
  type ScreenTimeSettings,
  writeScreenTimeSettings,
} from '@muna/contracts';
import { Button, ListRow, Text } from '@muna/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionRow, Section, SliderRow, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { formatClock } from './format';
import { useScreenTimeStore } from './screen-time-store';
import {
  exportScreenTime,
  type ScreenTimeFailure,
  useScreenTimeCommand,
  useScreenTimeSubscription,
} from './use-screen-time';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

const { idleMinutes: idleBounds, dayResetHour: hourBounds } = SCREEN_TIME_BOUNDS;

type Outcome =
  { kind: 'exported'; path: string } | { kind: 'failed'; failure: ScreenTimeFailure } | null;

/**
 * Settings → Screen time (docs/modules/screen-time.md): whether counting is on, how long
 * without input pauses it, when the day resets; the apps excluded from the count, each with a
 * way back in; and the data — export as CSV, or clear the history. Settings go through the
 * shared editor and reach Rust like any other; the exclusions and the data actions are
 * commands, answered with a fresh snapshot.
 */
export function ScreenTimeSettingsPane() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { settings, update } = useSettingsEditor();
  useScreenTimeSubscription();
  const snapshot = useScreenTimeStore((store) => store.snapshot);
  const send = useScreenTimeCommand();
  const screenTime = readScreenTimeSettings(settings);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const write = (
    recipe: (current: ScreenTimeSettings) => ScreenTimeSettings,
    debounced = false,
  ) => {
    update((current) => writeScreenTimeSettings(current, recipe(readScreenTimeSettings(current))), {
      debounced,
    });
  };

  const exportCsv = () => {
    setBusy(true);
    setOutcome(null);
    void exportScreenTime(t('screenTime.settings.exportTitle'))
      .then((result) => {
        if (result.status === 'error') {
          setOutcome({ kind: 'failed', failure: result.failure });
        } else if (result.data !== null) {
          setOutcome({ kind: 'exported', path: result.data });
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const clearHistory = () => {
    setConfirmingClear(false);
    void send({ kind: 'clearHistory' }).then((result) => {
      if (result.status === 'error') setOutcome({ kind: 'failed', failure: result.failure });
    });
  };

  const hourLabel = (hour: number) => formatClock(new Date(2000, 0, 1, hour).getTime(), locale);
  const excluded = snapshot?.excluded ?? [];

  return (
    <>
      <Section
        title={t('screenTime.settings.section')}
        visible={everything}
        rows={[
          {
            id: 'screenTime.enabled',
            node: (
              <ToggleRow
                label={t('screenTime.settings.enabled')}
                description={t('screenTime.settings.enabledBody')}
                isSelected={screenTime.enabled}
                onChange={(enabled) => {
                  write((current) => ({ ...current, enabled }));
                }}
              />
            ),
          },
          {
            id: 'screenTime.idleMinutes',
            node: (
              <SliderRow
                label={t('screenTime.settings.idle')}
                description={t('screenTime.settings.idleBody')}
                value={screenTime.idleMinutes}
                minValue={idleBounds.min}
                maxValue={idleBounds.max}
                format={(minutes) => t('screenTime.settings.idleMinutes', { count: minutes })}
                onChange={(idleMinutes) => {
                  write((current) => ({ ...current, idleMinutes }), true);
                }}
                onChangeEnd={(idleMinutes) => {
                  write((current) => ({ ...current, idleMinutes }));
                }}
              />
            ),
          },
          {
            id: 'screenTime.dayResetHour',
            node: (
              <SliderRow
                label={t('screenTime.settings.dayReset')}
                description={t('screenTime.settings.dayResetBody')}
                value={screenTime.dayResetHour}
                minValue={hourBounds.min}
                maxValue={hourBounds.max}
                format={hourLabel}
                onChange={(dayResetHour) => {
                  write((current) => ({ ...current, dayResetHour }), true);
                }}
                onChangeEnd={(dayResetHour) => {
                  write((current) => ({ ...current, dayResetHour }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('screenTime.settings.excluded')}
        description={t('screenTime.settings.excludedBody')}
        visible={everything}
        rows={
          excluded.length === 0
            ? [
                {
                  id: 'screenTime.excludedEmpty',
                  node: <ListRow label={t('screenTime.settings.excludedEmpty')} />,
                },
              ]
            : excluded.map((app) => ({
                id: `screenTime.excluded.${app.exe}`,
                node: (
                  <ActionRow
                    label={app.name}
                    description={app.exe}
                    action={
                      <Button
                        variant="secondary"
                        aria-label={t('screenTime.settings.include', { name: app.name })}
                        onPress={() => {
                          void send({ kind: 'include', exe: app.exe });
                        }}
                      >
                        {t('screenTime.settings.includeShort')}
                      </Button>
                    }
                  />
                ),
              }))
        }
      />
      <Section
        title={t('screenTime.settings.data')}
        visible={everything}
        rows={[
          {
            id: 'screenTime.export',
            node: (
              <ActionRow
                label={t('screenTime.settings.export')}
                description={t('screenTime.settings.exportBody')}
                action={
                  <Button variant="secondary" isDisabled={busy} onPress={exportCsv}>
                    {t('screenTime.settings.export')}
                  </Button>
                }
              />
            ),
          },
          {
            id: 'screenTime.clear',
            node: confirmingClear ? (
              <ActionRow
                label={t('screenTime.settings.clearQuestion')}
                action={
                  <>
                    <Button
                      onPress={() => {
                        setConfirmingClear(false);
                      }}
                    >
                      {t('screenTime.settings.cancel')}
                    </Button>
                    <Button variant="destructive" onPress={clearHistory}>
                      {t('screenTime.settings.clearConfirm')}
                    </Button>
                  </>
                }
              />
            ) : (
              <ActionRow
                label={t('screenTime.settings.clear')}
                description={t('screenTime.settings.clearBody')}
                action={
                  <Button
                    variant="destructive"
                    onPress={() => {
                      setConfirmingClear(true);
                    }}
                  >
                    {t('screenTime.settings.clear')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
      {outcome !== null && (
        <Text
          as="p"
          role="status"
          variant="footnote"
          tone={outcome.kind === 'failed' ? 'primary' : 'secondary'}
          className="px-3"
        >
          {outcome.kind === 'exported'
            ? t('screenTime.settings.exported', { path: outcome.path })
            : t(`screenTime.error.${outcome.failure}`)}
        </Text>
      )}
    </>
  );
}
