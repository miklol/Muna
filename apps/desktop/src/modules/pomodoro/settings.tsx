import {
  defaultPomodoroSettings,
  POMODORO_BOUNDS,
  type PomodoroSettings,
  readPomodoroSettings,
  writePomodoroSettings,
} from '@muna/contracts';
import { useTranslation } from 'react-i18next';

import { Section, SliderRow, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

type MinuteField = 'workMinutes' | 'shortBreakMinutes' | 'longBreakMinutes';

const MINUTE_FIELDS: readonly MinuteField[] = [
  'workMinutes',
  'shortBreakMinutes',
  'longBreakMinutes',
];

/**
 * Settings → Pomodoro (docs/modules/pomodoro.md): the three phase lengths, how many focus
 * phases make a cycle, and auto-start. Writes go through the shared editor so they save like
 * any other setting and reach Rust, which resizes an idle timer at once and leaves a running
 * one alone. Slider drags are debounced; the release saves.
 */
export function PomodoroSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const pomodoro = readPomodoroSettings(settings);

  const write = (recipe: (current: PomodoroSettings) => PomodoroSettings, debounced = false) => {
    update((current) => writePomodoroSettings(current, recipe(readPomodoroSettings(current))), {
      debounced,
    });
  };
  const minutes = (value: number) => t('pomodoro.settings.minutes', { count: value });

  return (
    <>
      <Section
        title={t('pomodoro.settings.lengths')}
        visible={everything}
        rows={MINUTE_FIELDS.map((field) => ({
          id: `pomodoro.${field}`,
          node: (
            <SliderRow
              label={t(`pomodoro.settings.${field}`)}
              value={pomodoro[field]}
              minValue={POMODORO_BOUNDS[field].min}
              maxValue={POMODORO_BOUNDS[field].max}
              format={minutes}
              onChange={(value) => {
                write((current) => ({ ...current, [field]: value }), true);
              }}
              onChangeEnd={(value) => {
                write((current) => ({ ...current, [field]: value }));
              }}
            />
          ),
        }))}
      />
      <Section
        title={t('pomodoro.settings.cycle')}
        visible={everything}
        rows={[
          {
            id: 'pomodoro.longBreakEvery',
            node: (
              <SliderRow
                label={t('pomodoro.settings.longBreakEvery')}
                description={t('pomodoro.settings.longBreakEveryBody')}
                value={pomodoro.longBreakEvery}
                minValue={POMODORO_BOUNDS.longBreakEvery.min}
                maxValue={POMODORO_BOUNDS.longBreakEvery.max}
                format={(value) => t('pomodoro.settings.phases', { count: value })}
                onChange={(longBreakEvery) => {
                  write((current) => ({ ...current, longBreakEvery }), true);
                }}
                onChangeEnd={(longBreakEvery) => {
                  write((current) => ({ ...current, longBreakEvery }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('pomodoro.settings.flow')}
        visible={everything}
        rows={[
          {
            id: 'pomodoro.autoStartNext',
            node: (
              <ToggleRow
                label={t('pomodoro.settings.autoStartNext')}
                description={t('pomodoro.settings.autoStartNextBody')}
                isSelected={pomodoro.autoStartNext}
                onChange={(autoStartNext) => {
                  write((current) => ({ ...current, autoStartNext }));
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
export const pomodoroDefaults = defaultPomodoroSettings;
