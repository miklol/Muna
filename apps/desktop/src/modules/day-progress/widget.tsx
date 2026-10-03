import { defaultSettings, readDayProgressSettings } from '@muna/contracts';
import { ProgressTrack, Text } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import { useMinuteNow } from '../../lib/minute-now';
import { useSettings } from '../../lib/settings';
import type { WidgetProps } from '../registry';
import './day-progress.css';
import { formatTime } from './panel';
import { buildTimeline } from './timeline';
import { useDaySources } from './use-day-progress';

/**
 * The day-progress card on the dashboard (docs/modules/dashboard.md "Widgets": Day Progress
 * card): how far the working day has come as a bar and a line — "45% over", "Starts at 09:00",
 * "Over for today" — and the day's task completion under it. Reads the same sources as the
 * panel and re-renders once a minute while mounted, never when unmounted.
 */
export function DayProgressWidget(_props: WidgetProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const settings = readDayProgressSettings(useSettings() ?? defaultSettings());
  const { tasks, pomodoro } = useDaySources();
  const now = useMinuteNow();
  const timeline = buildTimeline({ tasks: tasks ?? [], pomodoro, settings, now });
  const nowMs = now.getTime();
  const { done, total } = timeline.completion;

  let dayValue: string;
  let dayFill: number;
  if (timeline.dayPercent !== null) {
    const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' });
    dayValue = t('dayProgress.workingDayValue', {
      percent: percent.format(timeline.dayPercent / 100),
    });
    dayFill = timeline.dayPercent;
  } else if (nowMs < timeline.workStartMs) {
    dayValue = t('dayProgress.startsAt', { time: formatTime(timeline.workStartMs, locale) });
    dayFill = 0;
  } else {
    dayValue = t('dayProgress.over');
    dayFill = 100;
  }

  return (
    <div className="day-widget">
      <div className="day-widget__row">
        <Text as="span" variant="footnote" tone="secondary">
          {t('dayProgress.workingDay')}
        </Text>
        <Text as="span" variant="footnote" weight={600} tabular className="day-widget__value">
          {dayValue}
        </Text>
      </div>
      <ProgressTrack value={dayFill} aria-label={t('dayProgress.workingDayLabel')} />
      <div className="day-widget__row">
        <Text as="span" variant="caption" tone="tertiary">
          {t('dayProgress.completion')}
        </Text>
        <Text as="span" variant="caption" tone="tertiary" tabular className="day-widget__value">
          {total === 0
            ? t('dayProgress.completionNone')
            : t('dayProgress.completionValue', { done, total })}
        </Text>
      </div>
    </div>
  );
}
