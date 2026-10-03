import type { CalendarEvent, CalendarSnapshot, Tint } from '@muna/contracts';
import { commands } from '@muna/contracts';
import {
  Button,
  Chip,
  contentRecipe,
  EmptyState,
  IconButton,
  MonthGrid,
  Text,
  tintVar,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import {
  CalendarPlus,
  CircleAlert,
  CloudOff,
  ExternalLink,
  MapPin,
  RefreshCw,
  Video,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type CSSProperties, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMinuteNow } from '../../lib/minute-now';
import {
  type DayKey,
  dayKeyOf,
  eventsByDay,
  formatDayHeading,
  formatTimeRange,
  inProgress,
  isFetching,
  marksByDay,
  needsAttention,
  startOfDay,
  tintBySource,
} from './agenda';
import { useCalendarStore } from './calendar-store';
import { openEvent, useCalendarCommand, useCalendarSubscription } from './use-calendar';
import './calendar.css';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

const openSettings = () => {
  void commands.openSettings().catch(() => {
    // Outside Tauri (tests, Storybook) there is no settings window.
  });
};

interface AgendaRowProps {
  event: CalendarEvent;
  tint: Tint | undefined;
  nowMs: number;
  locale: string;
}

/**
 * One event: a bar in the calendar's colour, the time column, the title and place, and a
 * button for the meeting link or the event's page, opened through Rust.
 */
function AgendaRow({ event, tint, nowMs, locale }: AgendaRowProps) {
  const { t } = useTranslation();
  const style: CSSProperties | undefined =
    tint === undefined ? undefined : ({ '--calendar-tint': tintVar(tint) } as CSSProperties);
  const title = event.title === '' ? t('calendar.untitled') : event.title;
  return (
    <li className="calendar-event" style={style} data-now={inProgress(event, nowMs) || undefined}>
      <span className="calendar-event__bar" aria-hidden />
      <Text as="span" variant="caption" tabular className="calendar-event__time">
        {event.allDay ? t('calendar.allDay') : formatTimeRange(event, locale)}
      </Text>
      <span className="calendar-event__text">
        <Text as="span" variant="footnote" truncate={1}>
          {title}
        </Text>
        {event.location !== null && event.location !== '' && (
          <Text
            as="span"
            variant="caption"
            tone="tertiary"
            truncate={1}
            className="calendar-event__place"
          >
            <MapPin size={12} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
            {event.location}
          </Text>
        )}
      </span>
      {event.link !== null && (
        <Button
          variant={event.isMeeting && inProgress(event, nowMs) ? 'primary' : 'secondary'}
          className="calendar-event__action"
          icon={
            event.isMeeting ? (
              <Video strokeWidth={ICON_STROKE} />
            ) : (
              <ExternalLink strokeWidth={ICON_STROKE} />
            )
          }
          aria-label={t(event.isMeeting ? 'calendar.joinNamed' : 'calendar.openNamed', { title })}
          onPress={() => {
            void openEvent(event.id);
          }}
        >
          {t(event.isMeeting ? 'calendar.join' : 'calendar.open')}
        </Button>
      )}
    </li>
  );
}

interface AgendaProps {
  snapshot: CalendarSnapshot;
  days: ReadonlyMap<DayKey, readonly CalendarEvent[]>;
  tintOf: (sourceId: string) => Tint | undefined;
  day: DayKey;
  nowMs: number;
  locale: string;
  onRefresh: () => void;
}

/** The selected day's events with the day heading, the refresh button and the state chips. */
function Agenda({ snapshot, days, tintOf, day, nowMs, locale, onRefresh }: AgendaProps) {
  const { t } = useTranslation();
  const events = days.get(day) ?? [];
  const dayStart = startOfDay(day);
  const outsideWindow = dayStart < snapshot.windowStartMs || dayStart >= snapshot.windowEndMs;
  const fetching = isFetching(snapshot);

  return (
    <section className="calendar-agenda" aria-label={t('calendar.agenda')}>
      <header className="calendar-agenda__head">
        <div className="calendar-agenda__heading">
          <Text as="h3" variant="callout" className="calendar-agenda__title">
            {formatDayHeading(day, locale)}
          </Text>
          <Text as="span" variant="caption" tone="tertiary" tabular>
            {t('calendar.eventCount', { count: events.length })}
          </Text>
        </div>
        <span className="calendar-agenda__actions">
          {snapshot.offline && (
            <Chip icon={<CloudOff strokeWidth={ICON_STROKE} />}>{t('calendar.offline')}</Chip>
          )}
          {needsAttention(snapshot) && (
            <Chip icon={<CircleAlert strokeWidth={ICON_STROKE} />}>{t('calendar.attention')}</Chip>
          )}
          <IconButton
            aria-label={fetching ? t('calendar.refreshing') : t('calendar.refresh')}
            isDisabled={fetching}
            onPress={onRefresh}
          >
            <RefreshCw strokeWidth={ICON_STROKE} />
          </IconButton>
        </span>
      </header>
      {events.length === 0 ? (
        <Text as="p" variant="footnote" tone="secondary" className="calendar-agenda__none">
          {outsideWindow ? t('calendar.outsideWindow') : t('calendar.noEvents')}
        </Text>
      ) : (
        <ol className="calendar-agenda__list">
          {events.map((event) => (
            <AgendaRow
              key={event.id}
              event={event}
              tint={tintOf(event.sourceId)}
              nowMs={nowMs}
              locale={locale}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The calendar panel (docs/modules/calendar.md): the month on the left with today filled and
 * a dot per event in its calendar's colour, the selected day's agenda on the right with a
 * *Join* button when an event carries a meeting link. With no calendar subscribed it says
 * what to do; offline it keeps the cached events and says so in a chip, never a dialog. The
 * panel's only timer is the shared minute clock that moves the "now" marker while it is open;
 * the refresh clock and the strip countdown are Rust's.
 */
export function CalendarPanel() {
  const { t, i18n } = useTranslation();
  useCalendarSubscription();
  const snapshot = useCalendarStore((store) => store.snapshot);
  const send = useCalendarCommand();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const nowMs = useMinuteNow().getTime();
  const todayKey = dayKeyOf(nowMs);
  const [selected, setSelected] = useState<DayKey>(todayKey);
  const [onView, setOnView] = useState<DayKey>(todayKey);
  const days = useMemo(() => eventsByDay(snapshot?.events ?? []), [snapshot]);
  const tintOf = useMemo(() => tintBySource(snapshot?.sources ?? []), [snapshot]);
  const marks = useMemo(() => marksByDay(days, tintOf), [days, tintOf]);

  if (snapshot === null) return null;

  const refresh = () => {
    send({ kind: 'refresh' });
  };

  const body =
    snapshot.sources.length === 0 ? (
      <EmptyState
        className="calendar-empty"
        icon={<CalendarPlus size={24} strokeWidth={1.5} />}
        title={t('calendar.empty.title')}
        description={t('calendar.empty.body')}
        action={
          <Button variant="secondary" onPress={openSettings}>
            {t('calendar.empty.action')}
          </Button>
        }
      />
    ) : (
      <div className="calendar-layout">
        <MonthGrid
          aria-label={t('calendar.month')}
          className="calendar-month"
          value={selected}
          onChange={(day) => {
            setSelected(day);
            setOnView(day);
          }}
          focusedValue={onView}
          onFocusChange={setOnView}
          marks={marks}
          previousLabel={t('calendar.previousMonth')}
          nextLabel={t('calendar.nextMonth')}
          todayLabel={t('calendar.today')}
        />
        <Agenda
          snapshot={snapshot}
          days={days}
          tintOf={tintOf}
          day={selected}
          nowMs={nowMs}
          locale={locale}
          onRefresh={refresh}
        />
      </div>
    );

  return (
    <motion.div
      className="calendar-panel"
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      {body}
    </motion.div>
  );
}
