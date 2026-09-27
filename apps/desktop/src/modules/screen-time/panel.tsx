import {
  type AppCategory,
  type AppUsage,
  APP_CATEGORIES,
  commands,
  type CurrentApp,
  type DayUsage,
  limitProgress,
  SCREEN_TIME_LIMIT_PRESETS,
  type ScreenTimeSnapshot,
} from '@muna/contracts';
import {
  Button,
  Chip,
  contentRecipe,
  EmptyState,
  IconButton,
  ProgressTrack,
  SegmentedRing,
  segmentColor,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import {
  AppWindow,
  ArrowLeft,
  ArrowLeftRight,
  CalendarDays,
  Clock,
  Hourglass,
  Lock,
  Moon,
  Settings2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import {
  appByExe,
  barTint,
  categorySegments,
  categoryTint,
  formatClock,
  formatDuration,
  formatLimit,
  formatWeekday,
  formatWeekdayInitial,
  rankingScaleMs,
  weekAverageMs,
} from './format';
import { useScreenTimeStore } from './screen-time-store';
import { useScreenTimeCommand, useScreenTimeSubscription } from './use-screen-time';
import './screen-time.css';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;
/** Chip glyphs are 12 px. */
const CHIP_ICON = {
  size: 12,
  strokeWidth: ICON_STROKE,
  'aria-hidden': true,
  focusable: false,
} as const;
/** The donut in the insights column. */
export const DONUT_DIAMETER = 84;
/** App icons in the ranking and the now card. */
const APP_ICON_PX = 20;

type Layout = 'today' | 'week';

type View = { kind: 'overview' } | { kind: 'detail'; exe: string };

const openSettings = () => {
  void commands.openSettings().catch(() => {
    // Outside Tauri (tests, Storybook) there is no settings window.
  });
};

interface AppIconProps {
  icon: string | null;
  size?: number;
}

/** The app's own icon when Windows gave one, or a window glyph in its place. */
function AppIcon({ icon, size = APP_ICON_PX }: AppIconProps) {
  return icon === null ? (
    <span className="stime-app-icon" style={{ inlineSize: size, blockSize: size }}>
      <AppWindow size={size} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
    </span>
  ) : (
    <img className="stime-app-icon" src={icon} alt="" width={size} height={size} />
  );
}

interface InsightsProps {
  snapshot: ScreenTimeSnapshot;
}

/** The donut with today's total inside and the categories that have time, in legend order. */
function Insights({ snapshot }: InsightsProps) {
  const { t } = useTranslation();
  const shown = snapshot.categories.filter((entry) => entry.totalMs > 0);
  return (
    <section className="stime-insights" aria-label={t('screenTime.insights.label')}>
      <SegmentedRing
        diameter={DONUT_DIAMETER}
        segments={categorySegments(snapshot.categories)}
        aria-label={t('screenTime.donut.describe', {
          duration: formatDuration(snapshot.today.totalMs, t),
          count: shown.length,
        })}
      >
        <Text variant="footnote" weight={600} tabular>
          {formatDuration(snapshot.today.totalMs, t)}
        </Text>
      </SegmentedRing>
      {shown.length > 0 && (
        <ul className="stime-legend" aria-label={t('screenTime.insights.categories')}>
          {shown.map((entry) => (
            <li key={entry.category} className="stime-legend__row">
              <span
                aria-hidden="true"
                className="stime-legend__dot"
                style={{ background: segmentColor(categoryTint[entry.category]) }}
              />
              <Text
                as="span"
                variant="caption"
                tone="secondary"
                truncate={1}
                className="stime-legend__name"
              >
                {t(`screenTime.category.${entry.category}`)}
              </Text>
              <Text as="span" variant="caption" tabular className="stime-legend__value">
                {formatDuration(entry.totalMs, t)}
              </Text>
            </li>
          ))}
        </ul>
      )}
      <dl className="stime-facts">
        <div className="stime-legend__row">
          <Text
            as="dt"
            variant="caption"
            tone="secondary"
            truncate={1}
            className="stime-legend__name"
          >
            {t('screenTime.insights.average')}
          </Text>
          <Text as="dd" variant="caption" tabular className="stime-legend__value">
            {formatDuration(snapshot.today.averageMs, t)}
          </Text>
        </div>
        <div className="stime-legend__row">
          <Text
            as="dt"
            variant="caption"
            tone="secondary"
            truncate={1}
            className="stime-legend__name"
          >
            {t('screenTime.insights.longest')}
          </Text>
          <Text as="dd" variant="caption" tabular className="stime-legend__value">
            {formatDuration(snapshot.today.longestMs, t)}
          </Text>
        </div>
      </dl>
    </section>
  );
}

interface NowCardProps {
  snapshot: ScreenTimeSnapshot;
  locale: string;
}

/** What is being counted right now, or why nothing is: away, locked, off, or not yet. */
function NowCard({ snapshot, locale }: NowCardProps) {
  const { t } = useTranslation();
  const now: CurrentApp | null = snapshot.now;
  let glyph;
  let title: string;
  let body: string;
  if (now !== null) {
    glyph = <AppIcon icon={now.icon} size={24} />;
    title = now.name;
    body = `${t(`screenTime.category.${now.category}`)} · ${t('screenTime.now.since', {
      time: formatClock(now.sinceMs, locale),
    })}`;
  } else {
    switch (snapshot.tracking) {
      case 'idle':
        glyph = <Moon size={24} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
        title = t('screenTime.now.idle');
        body = t('screenTime.now.idleBody');
        break;
      case 'locked':
        glyph = <Lock size={24} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
        title = t('screenTime.now.locked');
        body = t('screenTime.now.lockedBody');
        break;
      case 'off':
        glyph = <Hourglass size={24} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
        title = t('screenTime.now.off');
        body = t('screenTime.now.offBody');
        break;
      case 'active':
        glyph = <AppWindow size={24} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
        title = t('screenTime.now.nothing');
        body = t('screenTime.now.nothingBody');
        break;
    }
  }
  return (
    <section
      className="stime-now"
      aria-label={t('screenTime.now.label')}
      data-tracking={snapshot.tracking}
    >
      <span className="stime-now__glyph">{glyph}</span>
      <span className="stime-now__text">
        <Text as="span" variant="footnote" weight={600} truncate={1}>
          {title}
        </Text>
        <Text as="span" variant="caption" tone="secondary" truncate={1}>
          {body}
        </Text>
      </span>
    </section>
  );
}

interface RankingProps {
  apps: readonly AppUsage[];
  onOpen: (app: AppUsage) => void;
}

/**
 * Today's apps, most time first. Each bar is the app's share of the leader; an app with a
 * daily limit draws its limit progress instead and turns orange once it is reached.
 */
function Ranking({ apps, onOpen }: RankingProps) {
  const { t } = useTranslation();
  if (apps.length === 0) {
    return (
      <Text as="p" variant="footnote" tone="tertiary" className="stime-ranking__empty">
        {t('screenTime.apps.empty')}
      </Text>
    );
  }
  const scale = rankingScaleMs(apps);
  return (
    <ul className="stime-ranking" aria-label={t('screenTime.apps.label')}>
      {apps.map((app) => {
        const duration = formatDuration(app.totalMs, t);
        const progress = limitProgress(app);
        const label =
          app.limitMinutes === null
            ? t('screenTime.apps.row', { name: app.name, duration })
            : t('screenTime.apps.rowLimit', {
                name: app.name,
                duration,
                limit: formatLimit(app.limitMinutes, t),
              });
        return (
          <li
            key={app.exe}
            className="stime-app"
            data-limit-reached={app.limitReached || undefined}
          >
            <AriaButton
              className="stime-app__button"
              aria-label={label}
              onPress={() => {
                onOpen(app);
              }}
            >
              <AppIcon icon={app.icon} />
              <span className="stime-app__text">
                <span className="stime-app__line">
                  <Text as="span" variant="footnote" weight={600} truncate={1}>
                    {app.name}
                  </Text>
                  <Text as="span" variant="footnote" tone="secondary" tabular>
                    {duration}
                  </Text>
                </span>
                <ProgressTrack
                  aria-hidden="true"
                  aria-label={duration}
                  className="stime-app__bar"
                  tint={barTint(app)}
                  value={progress ?? app.totalMs / scale}
                  maxValue={1}
                />
              </span>
            </AriaButton>
          </li>
        );
      })}
    </ul>
  );
}

interface WeekViewProps {
  snapshot: ScreenTimeSnapshot;
  locale: string;
}

/** The last seven days as stacked bars, oldest first; the axis is the locale's weekday initials. */
function WeekView({ snapshot, locale }: WeekViewProps) {
  const { t } = useTranslation();
  const scale = Math.max(1, ...snapshot.week.map((day) => day.totalMs));
  const average = weekAverageMs(snapshot.week);
  const last = snapshot.week.length - 1;
  return (
    <section className="stime-week" aria-label={t('screenTime.week.label')}>
      <Text as="p" variant="footnote" tone="secondary" tabular className="stime-week__average">
        {t('screenTime.week.average', { duration: formatDuration(average, t) })}
      </Text>
      <ol className="stime-week__bars">
        {snapshot.week.map((day: DayUsage, index) => {
          const isToday = index === last;
          const name = isToday ? t('screenTime.week.today') : formatWeekday(day.dayStartMs, locale);
          return (
            <li
              key={day.dayStartMs}
              className="stime-week__day"
              data-today={isToday || undefined}
              aria-label={t('screenTime.week.day', {
                day: name,
                duration: formatDuration(day.totalMs, t),
              })}
            >
              <span
                aria-hidden="true"
                className="stime-week__bar"
                style={{ blockSize: `${String((100 * day.totalMs) / scale)}%` }}
              >
                {day.byCategory
                  .filter((entry) => entry.totalMs > 0)
                  .map((entry) => (
                    <span
                      key={entry.category}
                      className="stime-week__segment"
                      style={{
                        flexGrow: entry.totalMs,
                        background: segmentColor(categoryTint[entry.category]),
                      }}
                    />
                  ))}
              </span>
              <Text
                as="span"
                aria-hidden="true"
                variant="caption"
                tone={isToday ? 'primary' : 'tertiary'}
                weight={isToday ? 600 : 400}
                className="stime-week__axis"
              >
                {formatWeekdayInitial(day.dayStartMs, locale)}
              </Text>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface DetailProps {
  app: AppUsage;
  onBack: () => void;
  onCategory: (category: AppCategory) => void;
  onLimit: (minutes: number | null) => void;
  onExclude: () => void;
}

/** One app: its day in numbers, the category it counts under, its daily limit, and *Exclude*. */
function Detail({ app, onBack, onCategory, onLimit, onExclude }: DetailProps) {
  const { t } = useTranslation();
  const facts = [
    formatDuration(app.totalMs, t),
    t('screenTime.apps.sessions', { count: app.sessions }),
    t('screenTime.detail.longest', { duration: formatDuration(app.longestMs, t) }),
  ].join(' · ');
  return (
    <section className="stime-detail" aria-label={app.name}>
      <header className="stime-detail__head">
        <IconButton aria-label={t('screenTime.detail.back')} onPress={onBack}>
          <ArrowLeft strokeWidth={ICON_STROKE} />
        </IconButton>
        <AppIcon icon={app.icon} size={24} />
        <span className="stime-detail__title">
          <Text as="h2" variant="body" weight={600} truncate={1}>
            {app.name}
          </Text>
          <Text as="p" variant="caption" tone="secondary" tabular truncate={1}>
            {facts}
          </Text>
        </span>
      </header>
      <div className="stime-detail__body">
        <div
          className="stime-detail__group"
          role="group"
          aria-label={t('screenTime.detail.category')}
        >
          <Text as="span" variant="caption" tone="tertiary">
            {t('screenTime.detail.category')}
          </Text>
          <div className="stime-chips">
            {APP_CATEGORIES.map((category) => (
              <Chip
                key={category}
                isSelected={app.category === category}
                onChange={(selected) => {
                  if (selected) onCategory(category);
                }}
              >
                {t(`screenTime.category.${category}`)}
              </Chip>
            ))}
          </div>
        </div>
        <div className="stime-detail__group" role="group" aria-label={t('screenTime.detail.limit')}>
          <Text as="span" variant="caption" tone="tertiary">
            {t('screenTime.detail.limit')}
          </Text>
          <div className="stime-chips">
            <Chip
              isSelected={app.limitMinutes === null}
              onChange={(selected) => {
                if (selected) onLimit(null);
              }}
            >
              {t('screenTime.detail.limitNone')}
            </Chip>
            {SCREEN_TIME_LIMIT_PRESETS.map((minutes) => (
              <Chip
                key={minutes}
                isSelected={app.limitMinutes === minutes}
                onChange={(selected) => {
                  if (selected) onLimit(minutes);
                }}
              >
                {formatLimit(minutes, t)}
              </Chip>
            ))}
          </div>
          <Text as="p" variant="caption" tone="tertiary">
            {app.limitReached
              ? t('screenTime.apps.limitReached')
              : t('screenTime.detail.limitBody')}
          </Text>
        </div>
        <div className="stime-detail__group stime-detail__group--row">
          <Button variant="destructive" onPress={onExclude}>
            {t('screenTime.detail.exclude')}
          </Button>
          <Text as="p" variant="caption" tone="tertiary">
            {t('screenTime.detail.excludeBody')}
          </Text>
        </div>
      </div>
    </section>
  );
}

interface OverviewProps {
  snapshot: ScreenTimeSnapshot;
  locale: string;
  layout: Layout;
  onLayout: (layout: Layout) => void;
  onOpen: (app: AppUsage) => void;
}

/** The head chips and the layout toggle, then today's columns or the week. */
function Overview({ snapshot, locale, layout, onLayout, onOpen }: OverviewProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* A div, not a header: the panel chrome already owns the banner landmark. */}
      <div className="stime-head">
        <Chip icon={<Clock {...CHIP_ICON} />}>
          <span className="tabular-nums">
            {t('screenTime.total', { duration: formatDuration(snapshot.today.totalMs, t) })}
          </span>
        </Chip>
        <Chip icon={<ArrowLeftRight {...CHIP_ICON} />}>
          <span className="tabular-nums">
            {t('screenTime.switches', { count: snapshot.today.switches })}
          </span>
        </Chip>
        <span className="stime-head__spacer" />
        <Chip
          icon={<CalendarDays {...CHIP_ICON} />}
          isSelected={layout === 'week'}
          onChange={(selected) => {
            onLayout(selected ? 'week' : 'today');
          }}
        >
          {t('screenTime.layout.week')}
        </Chip>
        <IconButton aria-label={t('screenTime.insights.settings')} onPress={openSettings}>
          <Settings2 strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      {layout === 'today' ? (
        <div className="stime-today">
          <Insights snapshot={snapshot} />
          <div className="stime-main">
            <NowCard snapshot={snapshot} locale={locale} />
            <Ranking apps={snapshot.apps} onOpen={onOpen} />
          </div>
        </div>
      ) : (
        <WeekView snapshot={snapshot} locale={locale} />
      )}
    </>
  );
}

/**
 * The screen time panel (docs/modules/screen-time.md): what is in front now, today's total by
 * category and by app, or the last seven days; an app row opens its details, where the category,
 * a daily limit and exclusion live. Nothing polls here: Rust publishes a snapshot with every
 * tick while the panel is mounted and stops when it is not.
 */
export function ScreenTimePanel() {
  const { t } = useTranslation();
  useScreenTimeSubscription();
  const snapshot = useScreenTimeStore((store) => store.snapshot);
  const send = useScreenTimeCommand();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');
  const [layout, setLayout] = useState<Layout>('today');
  const [view, setView] = useState<View>({ kind: 'overview' });
  const locale = useLocale();

  if (snapshot === null) return null;

  const backToOverview = () => {
    setView({ kind: 'overview' });
  };

  let body;
  if (view.kind === 'detail') {
    const app = appByExe(snapshot, view.exe);
    body =
      app === null ? (
        // The app left the ranking (excluded, or a new day): back to the overview.
        <EmptyState
          className="stime-empty"
          icon={<Hourglass size={24} strokeWidth={1.5} />}
          title={t('screenTime.error.unknown')}
          action={
            <Button variant="secondary" onPress={backToOverview}>
              {t('screenTime.detail.back')}
            </Button>
          }
        />
      ) : (
        <Detail
          app={app}
          onBack={backToOverview}
          onCategory={(category) => {
            void send({ kind: 'setCategory', exe: app.exe, category });
          }}
          onLimit={(minutes) => {
            void send({ kind: 'setLimit', exe: app.exe, minutes });
          }}
          onExclude={() => {
            void send({ kind: 'exclude', exe: app.exe });
            backToOverview();
          }}
        />
      );
  } else {
    body = (
      <Overview
        snapshot={snapshot}
        locale={locale}
        layout={layout}
        onLayout={setLayout}
        onOpen={(app) => {
          setView({ kind: 'detail', exe: app.exe });
        }}
      />
    );
  }

  return (
    <motion.div
      className="stime-panel"
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      {body}
    </motion.div>
  );
}
