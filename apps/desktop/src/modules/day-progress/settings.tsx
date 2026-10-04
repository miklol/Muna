import {
  DAY_PROGRESS_BOUNDS,
  type DayProgressSettings,
  readDayProgressSettings,
  writeDayProgressSettings,
} from '@muna/contracts';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import { Section, SliderRow, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/** The bedtime the toggle turns on: 23:00. */
export const DEFAULT_BEDTIME_MINUTES = 23 * 60;

const { min: firstMinute, max: lastMinute } = DAY_PROGRESS_BOUNDS.minuteOfDay;
const step = DAY_PROGRESS_BOUNDS.stepMinutes;
const minWork = DAY_PROGRESS_BOUNDS.minWorkingMinutes;

/** A time of day as the locale writes it, from minutes since midnight. */
export const formatMinutes = (minutes: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(2000, 0, 1, 0, minutes));

/** A start that leaves at least the shortest working day before the last minute. */
const clampStart = (minutes: number): number =>
  Math.min(Math.max(firstMinute, minutes), lastMinute - minWork);

/** An end at least the shortest working day after `start`. */
const clampEnd = (minutes: number, start: number): number =>
  Math.min(Math.max(start + minWork, minutes), lastMinute);

/**
 * Settings → Day (docs/modules/day-progress.md): the working hours the day bar and the
 * free-time hint cover, an optional bedtime, whether the bar sits in the strip, and which
 * sources the timeline merges. Writes go through the shared editor so they save like any other
 * setting and reach Rust, which moves the strip bar at once. Slider drags are debounced; the
 * release saves. Moving the start past the end drags the end along, so what is saved is always
 * a day that ends after it starts.
 */
export function DayProgressSettingsPane() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { settings, update } = useSettingsEditor();
  const day = readDayProgressSettings(settings);

  const write = (
    recipe: (current: DayProgressSettings) => DayProgressSettings,
    debounced = false,
  ) => {
    update(
      (current) => writeDayProgressSettings(current, recipe(readDayProgressSettings(current))),
      { debounced },
    );
  };
  const time = (minutes: number) => formatMinutes(minutes, locale);
  const setStart = (minutes: number, debounced: boolean) => {
    write((current) => {
      const workStartMinutes = clampStart(minutes);
      return {
        ...current,
        workStartMinutes,
        workEndMinutes: clampEnd(current.workEndMinutes, workStartMinutes),
      };
    }, debounced);
  };
  const setEnd = (minutes: number, debounced: boolean) => {
    write(
      (current) => ({ ...current, workEndMinutes: clampEnd(minutes, current.workStartMinutes) }),
      debounced,
    );
  };
  const setBedtime = (minutes: number, debounced: boolean) => {
    write(
      (current) => ({
        ...current,
        bedtimeMinutes: Math.min(Math.max(firstMinute, minutes), lastMinute),
      }),
      debounced,
    );
  };

  const bedtimeRows = [
    {
      id: 'dayProgress.showBedtime',
      node: (
        <ToggleRow
          label={t('dayProgress.settings.showBedtime')}
          description={t('dayProgress.settings.showBedtimeBody')}
          isSelected={day.bedtimeMinutes !== null}
          onChange={(on) => {
            write((current) => ({
              ...current,
              bedtimeMinutes: on ? DEFAULT_BEDTIME_MINUTES : null,
            }));
          }}
        />
      ),
    },
  ];
  if (day.bedtimeMinutes !== null) {
    bedtimeRows.push({
      id: 'dayProgress.bedtime',
      node: (
        <SliderRow
          label={t('dayProgress.settings.bedtimeAt')}
          value={day.bedtimeMinutes}
          minValue={firstMinute}
          maxValue={lastMinute}
          step={step}
          format={time}
          onChange={(minutes) => {
            setBedtime(minutes, true);
          }}
          onChangeEnd={(minutes) => {
            setBedtime(minutes, false);
          }}
        />
      ),
    });
  }

  return (
    <>
      <Section
        title={t('dayProgress.settings.hours')}
        description={t('dayProgress.settings.hoursBody')}
        visible={everything}
        rows={[
          {
            id: 'dayProgress.workStart',
            node: (
              <SliderRow
                label={t('dayProgress.settings.start')}
                value={day.workStartMinutes}
                minValue={firstMinute}
                maxValue={lastMinute - minWork}
                step={step}
                format={time}
                onChange={(minutes) => {
                  setStart(minutes, true);
                }}
                onChangeEnd={(minutes) => {
                  setStart(minutes, false);
                }}
              />
            ),
          },
          {
            id: 'dayProgress.workEnd',
            node: (
              <SliderRow
                label={t('dayProgress.settings.end')}
                value={day.workEndMinutes}
                minValue={day.workStartMinutes + minWork}
                maxValue={lastMinute}
                step={step}
                format={time}
                onChange={(minutes) => {
                  setEnd(minutes, true);
                }}
                onChangeEnd={(minutes) => {
                  setEnd(minutes, false);
                }}
              />
            ),
          },
        ]}
      />
      <Section title={t('dayProgress.settings.bedtime')} visible={everything} rows={bedtimeRows} />
      <Section
        title={t('dayProgress.settings.strip')}
        visible={everything}
        rows={[
          {
            id: 'dayProgress.showDayInStrip',
            node: (
              <ToggleRow
                label={t('dayProgress.settings.showDayInStrip')}
                description={t('dayProgress.settings.showDayInStripBody')}
                isSelected={day.showDayInStrip}
                onChange={(showDayInStrip) => {
                  write((current) => ({ ...current, showDayInStrip }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('dayProgress.settings.sources')}
        visible={everything}
        rows={[
          {
            id: 'dayProgress.showTasks',
            node: (
              <ToggleRow
                label={t('dayProgress.settings.showTasks')}
                description={t('dayProgress.settings.showTasksBody')}
                isSelected={day.showTasks}
                onChange={(showTasks) => {
                  write((current) => ({ ...current, showTasks }));
                }}
              />
            ),
          },
          {
            id: 'dayProgress.showFocusSessions',
            node: (
              <ToggleRow
                label={t('dayProgress.settings.showFocusSessions')}
                description={t('dayProgress.settings.showFocusSessionsBody')}
                isSelected={day.showFocusSessions}
                onChange={(showFocusSessions) => {
                  write((current) => ({ ...current, showFocusSessions }));
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}
