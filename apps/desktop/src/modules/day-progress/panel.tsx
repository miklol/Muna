import type { DayProgressSettings } from '@muna/contracts';
import { defaultSettings, readDayProgressSettings } from '@muna/contracts';
import type { Translate } from '@muna/i18n';
import {
  Button,
  Chip,
  contentRecipe,
  EmptyState,
  ProgressTrack,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { Circle, CircleCheck, Hourglass, Moon, Plus, Timer } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useMinuteNow } from '../../lib/minute-now';
import { useSettings } from '../../lib/settings';
import { useAppStore } from '../../store/app-store';
import './day-progress.css';
import {
  buildTimeline,
  type FreeStretch,
  MINUTE_MS,
  type Timeline,
  type TimelineItem,
} from './timeline';
import { useDaySources } from './use-day-progress';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;
const NODE_ICON = 14;

/** The to-do module's id: "Add a task" switches the panel to it, so it is hidden when off. */
const TODO_MODULE_ID = 'todo';

export const formatTime = (ms: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(ms));

export const formatDay = (day: Date, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(day);

/** `3 h 5 min`, `2 h` or `45 min`, from the catalog so every unit is translatable. */
export const formatDuration = (ms: number, t: Translate): string => {
  const minutes = Math.max(0, Math.round(ms / MINUTE_MS));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('dayProgress.duration.minutes', { count: rest });
  if (rest === 0) return t('dayProgress.duration.hours', { count: hours });
  return t('dayProgress.duration.hoursMinutes', { hours, minutes: rest });
};

type Row =
  | {
      readonly kind: 'item';
      readonly key: string;
      readonly atMs: number;
      readonly item: TimelineItem;
    }
  | { readonly kind: 'now'; readonly key: 'now'; readonly atMs: number }
  | { readonly kind: 'gap'; readonly key: 'gap'; readonly atMs: number; readonly gap: FreeStretch };

/** Items before the now marker before the free stretch when they share a moment. */
const rank: Record<Row['kind'], number> = { item: 0, now: 1, gap: 2 };

/**
 * The timeline rows in reading order: the items, the now marker where the clock stands, and
 * the free stretch where it begins (which is the now marker itself while nothing is on).
 */
export const timelineRows = (timeline: Timeline, nowMs: number): Row[] => {
  const rows: Row[] = timeline.items.map((item) => ({
    kind: 'item',
    key: item.id,
    atMs: item.startMs,
    item,
  }));
  rows.push({ kind: 'now', key: 'now', atMs: nowMs });
  if (timeline.gap !== null) {
    rows.push({ kind: 'gap', key: 'gap', atMs: timeline.gap.startMs, gap: timeline.gap });
  }
  return rows.sort((a, b) => a.atMs - b.atMs || rank[a.kind] - rank[b.kind]);
};

interface StatProps {
  readonly label: string;
  readonly value: string;
  readonly children?: ReactNode;
}

function Stat({ label, value, children }: StatProps) {
  return (
    <div className="day-stat">
      <div className="day-stat__row">
        <Text variant="footnote" tone="secondary">
          {label}
        </Text>
        <Text variant="footnote" tabular className="day-stat__value">
          {value}
        </Text>
      </div>
      {children}
    </div>
  );
}

interface StatsProps {
  readonly timeline: Timeline;
  readonly settings: DayProgressSettings;
  readonly now: Date;
  readonly locale: string;
}

function Stats({ timeline, settings, now, locale }: StatsProps) {
  const { t, i18n } = useTranslation();
  const { done, total } = timeline.completion;
  const nowMs = now.getTime();
  const percentText = new Intl.NumberFormat(i18n.language, { style: 'percent' });

  let dayValue: string;
  let dayFill: number;
  if (timeline.dayPercent !== null) {
    dayValue = t('dayProgress.workingDayValue', {
      percent: percentText.format(timeline.dayPercent / 100),
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
    <section className="day-stats" aria-label={t('dayProgress.stats')}>
      <header className="day-stats__heading">
        <Text as="h3" variant="callout" weight={600}>
          {t('dayProgress.today')}
        </Text>
        <Text variant="footnote" tone="secondary" className="day-stats__date">
          {formatDay(now, locale)}
        </Text>
      </header>
      <Stat
        label={t('dayProgress.completion')}
        value={
          total === 0
            ? t('dayProgress.completionNone')
            : t('dayProgress.completionValue', { done, total })
        }
      >
        <ProgressTrack
          tint="green"
          value={total === 0 ? 0 : (done / total) * 100}
          aria-label={t('dayProgress.completionLabel')}
        />
      </Stat>
      <Stat label={t('dayProgress.workingDay')} value={dayValue}>
        <ProgressTrack value={dayFill} aria-label={t('dayProgress.workingDayLabel')} />
      </Stat>
      <ul className="day-counts">
        {settings.showTasks && (
          <li>
            <Chip icon={<CircleCheck size={NODE_ICON} strokeWidth={ICON_STROKE} aria-hidden />}>
              {t('dayProgress.tasks', { count: total })}
            </Chip>
          </li>
        )}
        {settings.showFocusSessions && (
          <li>
            <Chip icon={<Timer size={NODE_ICON} strokeWidth={ICON_STROKE} aria-hidden />}>
              {t('dayProgress.focusSessions', { count: timeline.focusSessions })}
            </Chip>
          </li>
        )}
      </ul>
      <Stat
        label={t('dayProgress.bedtime')}
        value={
          timeline.bedtimeMs === null
            ? t('dayProgress.bedtimeUnset')
            : formatTime(timeline.bedtimeMs, locale)
        }
      />
    </section>
  );
}

const nodeIcon = (item: TimelineItem): ReactNode => {
  const props = { size: NODE_ICON, strokeWidth: ICON_STROKE, 'aria-hidden': true } as const;
  switch (item.kind) {
    case 'task':
      return item.done ? <CircleCheck {...props} /> : <Circle {...props} />;
    case 'focus':
      return <Timer {...props} />;
    case 'bedtime':
      return <Moon {...props} />;
  }
};

interface ItemRowProps {
  readonly item: TimelineItem;
  readonly locale: string;
}

function ItemRow({ item, locale }: ItemRowProps) {
  const { t } = useTranslation();
  let title: string;
  let detail: string | null = null;
  if (item.kind === 'task') {
    title = item.title ?? '';
    detail = t(item.done ? 'dayProgress.taskDone' : 'dayProgress.taskOpen');
  } else if (item.kind === 'focus') {
    title = t(item.paused ? 'dayProgress.focusPaused' : 'dayProgress.focus');
    if (item.endMs !== null) {
      detail = t('dayProgress.focusUntil', { time: formatTime(item.endMs, locale) });
    }
  } else {
    title = t('dayProgress.bedtime');
  }
  return (
    <>
      <Text as="time" variant="caption" tone="secondary" tabular className="day-row__time">
        {formatTime(item.startMs, locale)}
      </Text>
      <span className="day-row__node" aria-hidden="true">
        {nodeIcon(item)}
      </span>
      <span className="day-row__body">
        <Text variant="footnote" truncate={1} className="day-row__title">
          {title}
        </Text>
        {detail !== null && (
          <Text variant="caption2" tone="tertiary" className="day-row__detail">
            {detail}
          </Text>
        )}
      </span>
    </>
  );
}

interface GapRowProps {
  readonly gap: FreeStretch;
  readonly locale: string;
  readonly onAddTask: (() => void) | null;
}

function GapRow({ gap, locale, onAddTask }: GapRowProps) {
  const { t } = useTranslation();
  return (
    <>
      <span className="day-row__time" />
      <span className="day-row__node day-row__node--gap" aria-hidden="true" />
      <span className="day-row__body day-gap">
        <Text variant="footnote" className="day-row__title">
          {t('dayProgress.gap', { duration: formatDuration(gap.endMs - gap.startMs, t) })}
        </Text>
        <Text variant="caption2" tone="tertiary" className="day-row__detail">
          {t('dayProgress.gapBody', {
            start: formatTime(gap.startMs, locale),
            end: formatTime(gap.endMs, locale),
          })}
        </Text>
        {onAddTask !== null && (
          <Button
            variant="secondary"
            className="day-gap__action"
            icon={<Plus size={NODE_ICON} strokeWidth={ICON_STROKE} aria-hidden />}
            onPress={onAddTask}
          >
            {t('dayProgress.addTask')}
          </Button>
        )}
      </span>
    </>
  );
}

/**
 * The day-progress panel (docs/modules/day-progress.md): today's stats on the left — completion
 * of timed tasks, the share of the working day gone, per-source counts, bedtime — and the
 * timeline on the right, with a now marker that moves between the rows as the minutes pass
 * (the `layout` spring carries it) and a hint for the first long free stretch. Sources are the
 * to-do and pomodoro snapshots; nothing here talks to the OS.
 */
export function DayProgressPanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const settingsDocument = useSettings() ?? defaultSettings();
  const settings = readDayProgressSettings(settingsDocument);
  const { tasks, pomodoro } = useDaySources();
  const now = useMinuteNow();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');
  const layoutSpring = useMotionPreset('layout');
  const timeline = buildTimeline({ tasks: tasks ?? [], pomodoro, settings, now });
  const nowMs = now.getTime();
  const todoAvailable = !settingsDocument.shell.disabledModules.includes(TODO_MODULE_ID);
  const addTask = todoAvailable
    ? () => {
        useAppStore.getState().setActiveModule(TODO_MODULE_ID);
      }
    : null;

  let body: ReactNode;
  if (timeline.items.length === 0) {
    body = (
      <EmptyState
        className="day-empty"
        icon={<Hourglass size={24} strokeWidth={1.5} />}
        title={t('dayProgress.empty.title')}
        description={t('dayProgress.empty.body')}
        action={
          addTask === null ? undefined : (
            <Button variant="primary" onPress={addTask}>
              {t('dayProgress.addTask')}
            </Button>
          )
        }
      />
    );
  } else {
    body = (
      <LayoutGroup id="day-timeline">
        <ol className="day-timeline__list">
          {timelineRows(timeline, nowMs).map((row) => (
            <motion.li
              key={row.key}
              layout="position"
              transition={layoutSpring}
              className="day-row"
              data-kind={row.kind}
              data-done={(row.kind === 'item' && row.item.done) || undefined}
              aria-current={row.kind === 'now' ? 'time' : undefined}
            >
              {row.kind === 'item' && <ItemRow item={row.item} locale={locale} />}
              {row.kind === 'now' && (
                <>
                  <Text as="time" variant="caption" weight={600} tabular className="day-row__time">
                    {formatTime(nowMs, locale)}
                  </Text>
                  <span className="day-row__node day-row__node--now" aria-hidden="true" />
                  <span className="day-row__body">
                    <Text variant="footnote" weight={600} className="day-row__title">
                      {t('dayProgress.now')}
                    </Text>
                  </span>
                </>
              )}
              {row.kind === 'gap' && <GapRow gap={row.gap} locale={locale} onAddTask={addTask} />}
            </motion.li>
          ))}
        </ol>
      </LayoutGroup>
    );
  }

  return (
    <motion.div
      className="day-panel"
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      <Stats timeline={timeline} settings={settings} now={now} locale={locale} />
      <section className="day-timeline" aria-label={t('dayProgress.timeline')}>
        {body}
      </section>
    </motion.div>
  );
}
