import {
  BREATHE_PATTERNS,
  type BreathePattern,
  defaultHealthSettings,
  HEALTH_BOUNDS,
  type HealthSettings,
  readHealthSettings,
  writeHealthSettings,
} from '@muna/contracts';
import { Button, type SegmentedControlItem, Text } from '@muna/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import { ActionRow, Section, SegmentedRow, SliderRow, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { breatheRhythm } from './format';
import { useHealthCommand } from './use-health';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

const {
  breakEveryMin: intervalBounds,
  waterGoal: waterBounds,
  windDownHour: hourBounds,
} = HEALTH_BOUNDS;

/** The breaks goal Rust derives from the interval: a six-hour day of sitting, at least one. */
export const breaksGoalFor = (breakEveryMin: number): number =>
  Math.max(1, Math.floor(360 / breakEveryMin));

/** The wind-down hour the slider shows while the toggle is off, and the default when it goes on. */
const DEFAULT_WIND_DOWN_HOUR = 21;

/**
 * Settings → Health (docs/modules/health.md): whether sitting is tracked and how often to
 * remind, the water goal, the evening wind-down, the headphones warning, the breathing pattern,
 * and the data — reset today or clear the history. Settings go through the shared editor and
 * reach Rust like any other; the data actions are commands.
 */
export function HealthSettingsPane() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { settings, update } = useSettingsEditor();
  const health = readHealthSettings(settings);
  const send = useHealthCommand();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [notice, setNotice] = useState<'reset' | 'cleared' | null>(null);

  const write = (recipe: (current: HealthSettings) => HealthSettings, debounced = false) => {
    update((current) => writeHealthSettings(current, recipe(readHealthSettings(current))), {
      debounced,
    });
  };
  const minutes = (value: number) => t('health.settings.minutes', { count: value });
  const glasses = (value: number) => t('health.settings.glasses', { count: value });
  const hourLabel = (hour: number) =>
    new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(2000, 0, 1, hour));
  const patterns: SegmentedControlItem<BreathePattern>[] = BREATHE_PATTERNS.map((pattern) => ({
    id: pattern,
    label: `${t(`health.settings.patterns.${pattern}`)} ${breatheRhythm(pattern)}`,
  }));

  const resetToday = () => {
    void send({ kind: 'reset' }).then((done) => {
      if (done) setNotice('reset');
    });
  };
  const clearHistory = () => {
    setConfirmingClear(false);
    void send({ kind: 'clearHistory' }).then((done) => {
      if (done) setNotice('cleared');
    });
  };

  return (
    <>
      <Section
        title={t('health.settings.sitting')}
        visible={everything}
        rows={[
          {
            id: 'health.enabled',
            node: (
              <ToggleRow
                label={t('health.settings.enabled')}
                description={t('health.settings.enabledBody')}
                isSelected={health.enabled}
                onChange={(enabled) => {
                  write((current) => ({ ...current, enabled }));
                }}
              />
            ),
          },
          {
            id: 'health.breakEveryMin',
            node: (
              <SliderRow
                label={t('health.settings.breakEvery')}
                description={t('health.settings.breakEveryBody', {
                  count: breaksGoalFor(health.breakEveryMin),
                })}
                value={health.breakEveryMin}
                minValue={intervalBounds.min}
                maxValue={intervalBounds.max}
                step={5}
                format={minutes}
                onChange={(breakEveryMin) => {
                  write((current) => ({ ...current, breakEveryMin }), true);
                }}
                onChangeEnd={(breakEveryMin) => {
                  write((current) => ({ ...current, breakEveryMin }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('health.settings.goals')}
        visible={everything}
        rows={[
          {
            id: 'health.waterGoal',
            node: (
              <SliderRow
                label={t('health.settings.waterGoal')}
                description={t('health.settings.waterGoalBody')}
                value={health.waterGoal}
                minValue={waterBounds.min}
                maxValue={waterBounds.max}
                format={glasses}
                onChange={(waterGoal) => {
                  write((current) => ({ ...current, waterGoal }), true);
                }}
                onChangeEnd={(waterGoal) => {
                  write((current) => ({ ...current, waterGoal }));
                }}
              />
            ),
          },
          {
            id: 'health.breathePattern',
            node: (
              <SegmentedRow
                label={t('health.settings.breathePattern')}
                description={t('health.settings.breathePatternBody')}
                items={patterns}
                value={health.breathePattern}
                onChange={(breathePattern) => {
                  write((current) => ({ ...current, breathePattern }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('health.settings.evening')}
        visible={everything}
        rows={[
          {
            id: 'health.windDown',
            node: (
              <ToggleRow
                label={t('health.settings.windDown')}
                description={t('health.settings.windDownBody')}
                isSelected={health.windDownHour !== null}
                onChange={(on) => {
                  write((current) => ({
                    ...current,
                    windDownHour: on ? DEFAULT_WIND_DOWN_HOUR : null,
                  }));
                }}
              />
            ),
          },
          ...(health.windDownHour === null
            ? []
            : [
                {
                  id: 'health.windDownHour',
                  node: (
                    <SliderRow
                      label={t('health.settings.windDownHour')}
                      value={health.windDownHour}
                      minValue={hourBounds.min}
                      maxValue={hourBounds.max}
                      format={hourLabel}
                      onChange={(windDownHour) => {
                        write((current) => ({ ...current, windDownHour }), true);
                      }}
                      onChangeEnd={(windDownHour) => {
                        write((current) => ({ ...current, windDownHour }));
                      }}
                    />
                  ),
                },
              ]),
        ]}
      />
      <Section
        title={t('health.settings.hearing')}
        visible={everything}
        rows={[
          {
            id: 'health.hearingWarning',
            node: (
              <ToggleRow
                label={t('health.settings.hearingWarning')}
                description={t('health.settings.hearingWarningBody')}
                isSelected={health.hearingWarning}
                onChange={(hearingWarning) => {
                  write((current) => ({ ...current, hearingWarning }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('health.settings.data')}
        visible={everything}
        rows={[
          {
            id: 'health.resetToday',
            node: (
              <ActionRow
                label={t('health.settings.resetToday')}
                description={t('health.settings.resetTodayBody')}
                action={
                  <Button variant="secondary" onPress={resetToday}>
                    {t('health.settings.resetTodayAction')}
                  </Button>
                }
              />
            ),
          },
          {
            id: 'health.clear',
            node: confirmingClear ? (
              <ActionRow
                label={t('health.settings.clearQuestion')}
                action={
                  <>
                    <Button
                      onPress={() => {
                        setConfirmingClear(false);
                      }}
                    >
                      {t('health.settings.cancel')}
                    </Button>
                    <Button variant="destructive" onPress={clearHistory}>
                      {t('health.settings.clearConfirm')}
                    </Button>
                  </>
                }
              />
            ) : (
              <ActionRow
                label={t('health.settings.clear')}
                description={t('health.settings.clearBody')}
                action={
                  <Button
                    variant="destructive"
                    onPress={() => {
                      setConfirmingClear(true);
                    }}
                  >
                    {t('health.settings.clear')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
      {notice !== null && (
        <Text as="p" role="status" variant="footnote" tone="secondary" className="px-3">
          {t(notice === 'reset' ? 'health.settings.resetDone' : 'health.settings.clearDone')}
        </Text>
      )}
    </>
  );
}

/** What a fresh document reads as, for tests and stories. */
export const healthDefaults = defaultHealthSettings;
