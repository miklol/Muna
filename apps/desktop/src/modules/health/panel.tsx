import {
  type BreathePattern,
  commands,
  defaultSettings,
  type FlowState,
  type HealthFlow,
  type HealthSnapshot,
  type HearingState,
  readHealthSettings,
} from '@muna/contracts';
import {
  Button,
  Chip,
  contentRecipe,
  EmptyState,
  formatCountdown,
  IconButton,
  reducedMotionTransition,
  Ring,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import {
  Eye,
  Footprints,
  Heart,
  Lock,
  Minus,
  Moon,
  Play,
  Plus,
  Settings2,
  Square,
  Timer,
  Volume2,
  Wind,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { ComponentType, CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { usePanelHold } from '../../lib/panel-hold';
import { useSettings } from '../../lib/settings';
import {
  breathPhaseKey,
  breathPositionAt,
  breatheRhythm,
  breathTargetScale,
  FLOW_ORDER,
  flowTint,
  flowTitleKey,
  formatDuration,
  formatWeekday,
  formatWeekdayInitial,
  type HealthClock,
  mindfulMinutes,
  MOVE_PROMPT_KEYS,
  SECOND_MS,
  sliceAt,
  STRETCH_STEP_KEYS,
} from './format';
import { useHealthStore } from './health-store';
import './health.css';
import { useHealthClock } from './use-health-clock';
import { useHealthCommand, useHealthSubscription } from './use-health';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;
/** Chip glyphs are 12 px. */
const CHIP_ICON = {
  size: 12,
  strokeWidth: ICON_STROKE,
  'aria-hidden': true,
  focusable: false,
} as const;
/** The three goal rings, outermost first: 6 px strokes with a 3 px gap between them. */
export const RING_DIAMETERS = [96, 78, 60] as const;
/** The flow dial, with the countdown in display digits inside. */
export const FLOW_RING_DIAMETER = 112;

type LucideIcon = ComponentType<{
  size?: number;
  strokeWidth?: number;
  'aria-hidden'?: boolean;
  focusable?: boolean;
}>;

const flowGlyph: Readonly<Record<HealthFlow, LucideIcon>> = {
  move: Footprints,
  breathe: Wind,
  stretch: Timer,
  eyeRest: Eye,
};

const openSettings = () => {
  void commands.openSettings().catch(() => {
    // Outside Tauri (tests, Storybook) there is no settings window.
  });
};

interface HeadProps {
  snapshot: HealthSnapshot;
  clock: HealthClock;
  onStop: () => void;
}

/**
 * The head row: the heart with the sitting time (or why the timer is paused), the time to the
 * next reminder as a chip, and Settings. While a flow runs it names the flow and offers Stop.
 */
function Head({ snapshot, clock, onStop }: HeadProps) {
  const { t } = useTranslation();
  const flow = snapshot.flow;
  let glyph;
  let title: string;
  if (flow !== null) {
    const Glyph = flowGlyph[flow.flow];
    glyph = <Glyph size={16} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
    title = t(flowTitleKey[flow.flow]);
  } else {
    switch (snapshot.sitting) {
      case 'sitting':
        glyph = <Heart size={16} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
        title = t('health.head.sitting', { duration: formatDuration(clock.sittingMs, t) });
        break;
      case 'away':
        glyph = <Moon size={16} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
        title = t('health.head.away');
        break;
      case 'locked':
        glyph = <Lock size={16} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
        title = t('health.head.locked');
        break;
      case 'off':
        glyph = <Heart size={16} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
        title = t('health.head.off');
        break;
    }
  }
  let chip = null;
  if (flow !== null && clock.flowRemainingMs !== null) {
    chip = (
      <Chip icon={<Timer {...CHIP_ICON} />}>
        <span className="tabular-nums">
          {t('health.flow.remaining', { remaining: formatCountdown(clock.flowRemainingMs) })}
        </span>
      </Chip>
    );
  } else if (snapshot.breakDueSinceMs !== null) {
    chip = (
      <Chip icon={<Heart {...CHIP_ICON} />} className="health-chip" data-tint="pink">
        {t('health.head.breakDue')}
      </Chip>
    );
  } else if (clock.nextBreakInMs !== null && snapshot.sitting === 'sitting') {
    chip = (
      <Chip
        icon={<Timer {...CHIP_ICON} />}
        aria-label={t('health.head.nextBreak', {
          duration: formatDuration(clock.nextBreakInMs, t),
        })}
      >
        <span className="tabular-nums">{formatDuration(clock.nextBreakInMs, t)}</span>
      </Chip>
    );
  }
  return (
    // A div, not a header: the panel chrome already owns the banner landmark.
    <div className="health-head" data-sitting={snapshot.sitting}>
      <span className="health-head__glyph" data-tint={flow === null ? 'pink' : flowTint[flow.flow]}>
        {glyph}
      </span>
      <Text as="h3" variant="footnote" weight={600} truncate={1} className="health-head__title">
        {title}
      </Text>
      {chip}
      {snapshot.windingDown && flow === null && (
        <Chip icon={<Moon {...CHIP_ICON} />} className="health-chip" data-tint="purple">
          {t('health.head.windingDown')}
        </Chip>
      )}
      <span className="health-head__spacer" />
      {flow === null ? (
        <IconButton aria-label={t('health.head.settings')} onPress={openSettings}>
          <Settings2 strokeWidth={ICON_STROKE} />
        </IconButton>
      ) : (
        <Button
          variant="secondary"
          icon={
            <Square
              size={12}
              strokeWidth={ICON_STROKE}
              fill="currentColor"
              aria-hidden
              focusable={false}
            />
          }
          onPress={onStop}
        >
          {t('health.flow.stop')}
        </Button>
      )}
    </div>
  );
}

interface TodayProps {
  snapshot: HealthSnapshot;
  hearing: HearingState | null;
}

/** Left column: today's four facts and the streak; the hearing warning when one is up. */
function Today({ snapshot, hearing }: TodayProps) {
  const { t } = useTranslation();
  const { today } = snapshot;
  const facts: readonly [string, string][] = [
    [t('health.today.active'), formatDuration(today.activeMs, t)],
    [t('health.today.longestSit'), formatDuration(today.longestSitMs, t)],
    [t('health.today.breaks'), String(today.breaks)],
    [
      t('health.today.mindful'),
      t('health.duration.minutes', { count: mindfulMinutes(today.mindfulSeconds) }),
    ],
  ];
  return (
    <section className="health-today" aria-label={t('health.today.label')}>
      <div className="health-today__head">
        <Text as="span" variant="caption" tone="secondary" weight={600} className="health-caption">
          {t('health.today.label')}
        </Text>
        {snapshot.streakDays > 0 && (
          <Text as="span" variant="caption" tone="tertiary" tabular>
            {t('health.today.streak', { count: snapshot.streakDays })}
          </Text>
        )}
      </div>
      <dl className="health-facts">
        {facts.map(([label, value]) => (
          <div key={label} className="health-facts__row">
            <Text as="dt" variant="caption" tone="secondary">
              {label}
            </Text>
            <Text as="dd" variant="footnote" weight={600} tabular>
              {value}
            </Text>
          </div>
        ))}
      </dl>
      {hearing !== null && hearing.warned && (
        <div className="health-hearing" role="status">
          <Volume2 size={14} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
          <Text as="span" variant="caption" truncate={2}>
            {t('health.hearing.body', {
              percent: hearing.percent,
              duration: formatDuration(hearing.loudForMs, t),
            })}
          </Text>
        </div>
      )}
    </section>
  );
}

interface GoalsProps {
  snapshot: HealthSnapshot;
  locale: string;
  onWater: (delta: number) => void;
}

/**
 * Middle column: the three concentric goal rings (green breaks, blue water, purple mindful),
 * the weekday dots filled by goals met, and the counters with the water − / + buttons. The
 * rings follow value changes with the `interactive` spring the primitive carries.
 */
function Goals({ snapshot, locale, onWater }: GoalsProps) {
  const { t } = useTranslation();
  const { today, goals } = snapshot;
  const mindful = mindfulMinutes(today.mindfulSeconds);
  const mindfulGoal = Math.max(1, mindfulMinutes(goals.mindfulSeconds));
  const rings = [
    {
      id: 'breaks',
      tint: 'green',
      label: t('health.rings.breaks'),
      value: today.breaks,
      goal: goals.breaks,
      text: t('health.rings.breaksValue', { count: today.breaks, goal: goals.breaks }),
    },
    {
      id: 'water',
      tint: 'blue',
      label: t('health.rings.water'),
      value: today.water,
      goal: goals.water,
      text: t('health.rings.waterValue', { count: today.water, goal: goals.water }),
    },
    {
      id: 'mindful',
      tint: 'purple',
      label: t('health.rings.mindful'),
      value: mindful,
      goal: mindfulGoal,
      text: t('health.rings.mindfulValue', { count: mindful, goal: mindfulGoal }),
    },
  ] as const;
  return (
    <section className="health-goals" aria-label={t('health.rings.label')}>
      <div className="health-rings">
        {rings.map((ring, index) => (
          <Ring
            key={ring.id}
            className="health-rings__ring"
            diameter={RING_DIAMETERS[index] ?? RING_DIAMETERS[2]}
            size="small"
            tint={ring.tint}
            aria-label={ring.label}
            value={Math.min(ring.value, ring.goal)}
            minValue={0}
            maxValue={ring.goal}
            valueText={ring.text}
          />
        ))}
      </div>
      <div className="health-goals__side">
        <ul className="health-counters">
          {rings.map((ring) => (
            <li key={ring.id} className="health-counters__row" data-ring={ring.id}>
              <span
                className="health-counters__dot"
                style={{ background: `var(--accent-${ring.tint})` }}
              />
              <Text as="span" variant="caption" tone="secondary" className="health-counters__label">
                {ring.label}
              </Text>
              <Text as="span" variant="caption" weight={600} tabular>
                {t('health.rings.counter', { count: ring.value, goal: ring.goal })}
              </Text>
              {ring.id === 'water' && (
                <span className="health-counters__buttons">
                  <IconButton
                    aria-label={t('health.rings.removeWater')}
                    isDisabled={today.water === 0}
                    onPress={() => {
                      onWater(-1);
                    }}
                  >
                    <Minus strokeWidth={ICON_STROKE} />
                  </IconButton>
                  <IconButton
                    aria-label={t('health.rings.addWater')}
                    onPress={() => {
                      onWater(1);
                    }}
                  >
                    <Plus strokeWidth={ICON_STROKE} />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
        <ul className="health-week" aria-label={t('health.week.label')}>
          {snapshot.week.map((day, index) => {
            const isToday = index === snapshot.week.length - 1;
            return (
              <li
                key={day.dayStartMs}
                className="health-week__day"
                data-today={isToday || undefined}
                aria-label={t('health.week.day', {
                  day: isToday ? t('health.week.today') : formatWeekday(day.dayStartMs, locale),
                  count: day.goalsMet,
                })}
              >
                <span
                  className="health-week__dot"
                  style={{ '--met': day.goalsMet } as CSSProperties}
                />
                <span className="health-week__initial" aria-hidden="true">
                  {formatWeekdayInitial(day.dayStartMs, locale)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

interface FlowCardsProps {
  snapshot: HealthSnapshot;
  pattern: BreathePattern;
  clock: HealthClock;
  onStart: (flow: HealthFlow) => void;
  onSnooze: () => void;
  onDismiss: () => void;
}

/**
 * Right column: "Take a break" and the four flow cards, each a button that starts its flow.
 * While a reminder is up the column leads with it — how long the sit has been, snooze, dismiss.
 */
function FlowCards({ snapshot, pattern, clock, onStart, onSnooze, onDismiss }: FlowCardsProps) {
  const { t } = useTranslation();
  const bodies: Readonly<Record<HealthFlow, string>> = {
    move: t('health.flows.move.body'),
    breathe: breatheRhythm(pattern),
    stretch: t('health.flows.stretch.body'),
    eyeRest: t('health.flows.eyeRest.body'),
  };
  const due = snapshot.breakDueSinceMs !== null;
  return (
    <section
      className="health-flows"
      aria-label={t('health.flows.label')}
      data-due={due || undefined}
    >
      {due ? (
        <div className="health-break" role="status">
          <span className="health-break__text">
            <Text as="span" variant="footnote" weight={600}>
              {t('health.break.title')}
            </Text>
            <Text as="span" variant="caption" tone="secondary" truncate={1}>
              {t('health.break.body', { duration: formatDuration(clock.sittingMs, t) })}
            </Text>
          </span>
          <span className="health-break__actions">
            <Button variant="secondary" onPress={onSnooze}>
              {t('health.break.snooze')}
            </Button>
            <Button variant="secondary" onPress={onDismiss}>
              {t('health.break.dismiss')}
            </Button>
          </span>
        </div>
      ) : (
        <Text as="span" variant="caption" tone="secondary" weight={600} className="health-caption">
          {t('health.flows.label')}
        </Text>
      )}
      <ul className="health-cards">
        {FLOW_ORDER.map((flow) => {
          const Glyph = flowGlyph[flow];
          const title = t(flowTitleKey[flow]);
          return (
            <li key={flow}>
              <button
                type="button"
                className="health-card"
                data-tint={flowTint[flow]}
                aria-label={t('health.flows.start', { flow: title })}
                onClick={() => {
                  onStart(flow);
                }}
              >
                <span className="health-card__glyph">
                  <Glyph size={16} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
                </span>
                <span className="health-card__text">
                  <Text as="span" variant="footnote" weight={600} truncate={1}>
                    {title}
                  </Text>
                  <Text as="span" variant="caption" tone="secondary" tabular truncate={1}>
                    {bodies[flow]}
                  </Text>
                </span>
                <span className="health-card__play">
                  <Play
                    size={12}
                    strokeWidth={ICON_STROKE}
                    fill="currentColor"
                    aria-hidden
                    focusable={false}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface BreathCircleProps {
  flow: FlowState;
  elapsedMs: number;
}

/**
 * The breathing circle: grows over the inhale, rests on the hold, shrinks over the exhale. The
 * animation's length is the phase's length from the pattern (4, 7 or 8 s) — pacing the user
 * is the content here, not a UI transition — so it is the one place a duration is not a
 * preset. Under reduced motion the circle sits still and the words carry the rhythm.
 */
function BreathCircle({ flow, elapsedMs }: BreathCircleProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const position = breathPositionAt(flow.pattern, elapsedMs, flow.totalMs);
  const { phase } = position;
  const target = breathTargetScale(flow.pattern, position.index);
  const leftInPhaseMs = Math.max(0, phase.seconds * SECOND_MS - position.intoMs);
  const secondsLeft = Math.max(1, Math.ceil(leftInPhaseMs / SECOND_MS));
  return (
    <div className="health-breathe" data-phase={phase.kind}>
      <div className="health-breathe__stage">
        <motion.div
          className="health-breathe__circle"
          initial={false}
          animate={{ scale: reduceMotion ? 1 : target }}
          transition={
            reduceMotion
              ? reducedMotionTransition
              : { duration: Math.max(0.1, leftInPhaseMs / SECOND_MS), ease: 'easeInOut' }
          }
        />
        <Text as="span" variant="title3" className="health-breathe__word" aria-live="polite">
          {t(breathPhaseKey[phase.kind])}
        </Text>
      </div>
      <div className="health-breathe__meta">
        <Text
          as="span"
          variant="display"
          tabular
          className="health-breathe__count"
          aria-hidden="true"
        >
          {secondsLeft}
        </Text>
        <Text as="span" variant="caption" tone="secondary" tabular>
          {t('health.flow.breathe.round', { current: position.round, total: position.rounds })}
        </Text>
      </div>
    </div>
  );
}

interface FlowViewProps {
  flow: FlowState;
  clock: HealthClock;
}

/**
 * The running flow, in place of the columns: the dial with the countdown on the left and the
 * flow's guidance on the right — Move's prompt of the moment, the breathing circle, Stretch's
 * step list with the current step lit, Eye rest's one instruction.
 */
function FlowView({ flow, clock }: FlowViewProps) {
  const { t } = useTranslation();
  const remaining = clock.flowRemainingMs ?? flow.remainingMs;
  const elapsed = clock.flowElapsedMs ?? Math.max(0, flow.totalMs - flow.remainingMs);
  const title = t(flowTitleKey[flow.flow]);
  let guidance;
  switch (flow.flow) {
    case 'move': {
      const index = sliceAt(elapsed, flow.totalMs, MOVE_PROMPT_KEYS.length);
      const key = MOVE_PROMPT_KEYS[index] ?? MOVE_PROMPT_KEYS[0];
      guidance = (
        <div className="health-guidance">
          <Text as="p" variant="title2" className="health-prompt" aria-live="polite">
            {key === undefined ? '' : t(key)}
          </Text>
          <ul className="health-prompt__dots" aria-hidden="true">
            {MOVE_PROMPT_KEYS.map((prompt, dot) => (
              <li
                key={prompt}
                className="health-prompt__dot"
                data-done={dot <= index || undefined}
              />
            ))}
          </ul>
        </div>
      );
      break;
    }
    case 'breathe':
      guidance = <BreathCircle flow={flow} elapsedMs={elapsed} />;
      break;
    case 'stretch': {
      const index = sliceAt(elapsed, flow.totalMs, STRETCH_STEP_KEYS.length);
      guidance = (
        <ol className="health-steps" aria-label={title}>
          {STRETCH_STEP_KEYS.map((step, position) => (
            <li
              key={step}
              className="health-steps__step"
              data-current={position === index || undefined}
              data-done={position < index || undefined}
              aria-current={position === index ? 'step' : undefined}
            >
              <Text
                as="span"
                variant="footnote"
                weight={position === index ? 600 : 400}
                truncate={1}
              >
                {t(step)}
              </Text>
            </li>
          ))}
        </ol>
      );
      break;
    }
    case 'eyeRest':
      guidance = (
        <div className="health-guidance">
          <Text as="p" variant="title3" className="health-prompt">
            {t('health.flow.eyeRest.body')}
          </Text>
          <Text as="p" variant="footnote" tone="secondary">
            {t('health.flow.eyeRest.hint')}
          </Text>
        </div>
      );
      break;
  }
  return (
    <div className="health-flow" data-flow={flow.flow}>
      <Ring
        className="health-flow__ring"
        diameter={FLOW_RING_DIAMETER}
        tint={flowTint[flow.flow]}
        aria-label={title}
        value={remaining}
        minValue={0}
        maxValue={Math.max(1, flow.totalMs)}
        valueText={t('health.flow.ring', { flow: title, remaining: formatCountdown(remaining) })}
      >
        <Text as="time" variant="title1" tabular className="health-flow__countdown">
          {formatCountdown(remaining)}
        </Text>
      </Ring>
      <div className="health-flow__guidance">{guidance}</div>
    </div>
  );
}

/**
 * The health panel (docs/modules/health.md; docs/reference/ui-observations.md "Health"): the
 * sitting timer in the head with the time to the next reminder, then three columns — today's
 * facts, the goal rings with the week and the water counter, and the four flows. Starting a
 * flow replaces the columns with its guidance and holds the panel open until it ends or is
 * stopped. The clocks tick once a second only while something counts and the panel is mounted;
 * Rust owns the time and republishes on every change.
 */
export function HealthPanel() {
  const { t, i18n } = useTranslation();
  useHealthSubscription();
  const snapshot = useHealthStore((store) => store.snapshot);
  const receivedAt = useHealthStore((store) => store.receivedAt);
  const clock = useHealthClock(snapshot, receivedAt);
  const send = useHealthCommand();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  // The Breathe card prints the pattern the settings pick; a running flow carries its own.
  const { breathePattern } = readHealthSettings(useSettings() ?? defaultSettings());
  usePanelHold(snapshot !== null && snapshot.flow !== null);

  if (snapshot === null) return null;

  let body;
  if (snapshot.flow !== null) {
    body = <FlowView flow={snapshot.flow} clock={clock} />;
  } else if (snapshot.sitting === 'off') {
    body = (
      <EmptyState
        className="health-empty"
        icon={<Heart size={24} strokeWidth={1.5} />}
        title={t('health.state.offTitle')}
        description={t('health.state.offBody')}
        action={
          <Button variant="secondary" onPress={openSettings}>
            {t('health.state.openSettings')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="health-columns">
        <Today snapshot={snapshot} hearing={snapshot.hearing} />
        <Goals
          snapshot={snapshot}
          locale={locale}
          onWater={(delta) => {
            void send({ kind: 'water', delta });
          }}
        />
        <FlowCards
          snapshot={snapshot}
          pattern={breathePattern}
          clock={clock}
          onStart={(flow) => {
            void send({ kind: 'startFlow', flow });
          }}
          onSnooze={() => {
            void send({ kind: 'snooze' });
          }}
          onDismiss={() => {
            void send({ kind: 'dismiss' });
          }}
        />
      </div>
    );
  }

  return (
    <motion.div
      className="health-panel"
      data-flow={snapshot.flow?.flow}
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      <Head
        snapshot={snapshot}
        clock={clock}
        onStop={() => {
          void send({ kind: 'stopFlow' });
        }}
      />
      {body}
    </motion.div>
  );
}
