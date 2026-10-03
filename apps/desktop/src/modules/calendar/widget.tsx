import type { Tint } from '@muna/contracts';
import { Text, tintVar } from '@muna/ui';
import { CalendarCheck, CalendarPlus } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { useMinuteNow } from '../../lib/minute-now';
import type { WidgetProps } from '../registry';
import { dayKeyOf, formatShortDay, formatTime, tintBySource, upcoming } from './agenda';
import { useCalendarStore } from './calendar-store';
import { useCalendarSubscription } from './use-calendar';
import './calendar.css';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The card shows the next three events (docs/modules/dashboard.md "Widgets": Events). */
export const WIDGET_EVENTS = 3;

const tintStyle = (tint: Tint | undefined): CSSProperties | undefined =>
  tint === undefined ? undefined : ({ '--calendar-tint': tintVar(tint) } as CSSProperties);

/**
 * The events card on the dashboard: the next three events that have not ended, each as its
 * start time (or the day, when it is not today) and title, coloured like its calendar; a wide
 * card adds the place. Without a calendar, or with nothing ahead, it says so in one line.
 */
export function CalendarWidget({ span }: WidgetProps) {
  const { t, i18n } = useTranslation();
  useCalendarSubscription();
  const snapshot = useCalendarStore((store) => store.snapshot);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const nowMs = useMinuteNow().getTime();

  if (snapshot === null) return null;

  const todayKey = dayKeyOf(nowMs);
  const next = upcoming(snapshot.events, nowMs, WIDGET_EVENTS);

  if (snapshot.sources.length === 0 || next.length === 0) {
    const none = snapshot.sources.length === 0;
    return (
      <div className="calendar-widget" data-empty>
        <span className="calendar-widget__glyph">
          {none ? (
            <CalendarPlus strokeWidth={ICON_STROKE} />
          ) : (
            <CalendarCheck strokeWidth={ICON_STROKE} />
          )}
        </span>
        <Text as="p" variant="footnote" tone="secondary" className="calendar-widget__note">
          {none ? t('calendar.empty.title') : t('calendar.widget.nothingAhead')}
        </Text>
      </div>
    );
  }

  const tintOf = tintBySource(snapshot.sources);
  return (
    <ol className="calendar-widget" aria-label={t('calendar.widget.label')}>
      {next.map((event) => {
        const today = dayKeyOf(event.startMs) === todayKey;
        let when: string;
        if (event.allDay) {
          when = today ? t('calendar.allDay') : formatShortDay(event.startMs, locale);
        } else {
          when = today ? formatTime(event.startMs, locale) : formatShortDay(event.startMs, locale);
        }
        return (
          <li
            key={event.id}
            className="calendar-widget__row"
            style={tintStyle(tintOf(event.sourceId))}
          >
            <Text as="span" variant="caption" tabular className="calendar-widget__time">
              {when}
            </Text>
            <Text as="span" variant="footnote" truncate={1} className="calendar-widget__title">
              {event.title === '' ? t('calendar.untitled') : event.title}
            </Text>
            {span === 2 && event.location !== null && event.location !== '' && (
              <Text
                as="span"
                variant="caption"
                tone="tertiary"
                truncate={1}
                className="calendar-widget__place"
              >
                {event.location}
              </Text>
            )}
          </li>
        );
      })}
    </ol>
  );
}
