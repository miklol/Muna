import type { BreathePattern, HealthFlow, HealthSnapshot } from '@muna/contracts';
import type { MessageKey, Translate } from '@muna/i18n';
import type { Tint } from '@muna/ui';

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

/**
 * `1 h 15 min`, `1 h`, `45 min` or `0 min`, every unit from the catalog. Whole minutes: the
 * sitting timer and the stats are not stopwatches (the flows use `formatCountdown`).
 */
export const formatDuration = (ms: number, t: Translate): string => {
  const minutes = Math.max(0, Math.floor(ms / MINUTE_MS));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('health.duration.minutes', { count: rest });
  if (rest === 0) return t('health.duration.hours', { count: hours });
  return t('health.duration.hoursMinutes', { hours, minutes: rest });
};

/** Mindful time is kept in seconds; the panel shows whole minutes. */
export const mindfulMinutes = (seconds: number): number => Math.floor(Math.max(0, seconds) / 60);

/** The short weekday name for a day ("Mon"). */
export const formatWeekday = (dayStartMs: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(dayStartMs));

/** The one-letter weekday under each dot, from the same locale. */
export const formatWeekdayInitial = (dayStartMs: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(dayStartMs));

/** The panel's flows in card order (docs/modules/health.md "Reference"). */
export const FLOW_ORDER: readonly HealthFlow[] = ['move', 'breathe', 'stretch', 'eyeRest'];

export const flowTitleKey: Readonly<Record<HealthFlow, MessageKey>> = {
  move: 'health.flows.move.title',
  breathe: 'health.flows.breathe.title',
  stretch: 'health.flows.stretch.title',
  eyeRest: 'health.flows.eyeRest.title',
};

/** Each flow keeps the colour of the ring it feeds; Move and Stretch count as breaks. */
export const flowTint: Readonly<Record<HealthFlow, Tint>> = {
  move: 'green',
  breathe: 'purple',
  stretch: 'green',
  eyeRest: 'blue',
};

/** Move rotates through six prompts over its three minutes. */
export const MOVE_PROMPT_KEYS: readonly MessageKey[] = [
  'health.flow.move.prompt1',
  'health.flow.move.prompt2',
  'health.flow.move.prompt3',
  'health.flow.move.prompt4',
  'health.flow.move.prompt5',
  'health.flow.move.prompt6',
];

/** Stretch walks six steps over its two minutes. */
export const STRETCH_STEP_KEYS: readonly MessageKey[] = [
  'health.flow.stretch.step1',
  'health.flow.stretch.step2',
  'health.flow.stretch.step3',
  'health.flow.stretch.step4',
  'health.flow.stretch.step5',
  'health.flow.stretch.step6',
];

/**
 * Which of `count` equal slices of a `totalMs` flow `elapsedMs` falls in; the last slice
 * absorbs the end so a finished flow still points at a valid prompt.
 */
export const sliceAt = (elapsedMs: number, totalMs: number, count: number): number => {
  if (count <= 0) return 0;
  if (totalMs <= 0) return count - 1;
  const index = Math.floor((Math.max(0, elapsedMs) / totalMs) * count);
  return Math.min(count - 1, Math.max(0, index));
};

export type BreathPhaseKind = 'inhale' | 'hold' | 'exhale';

export interface BreathPhase {
  readonly kind: BreathPhaseKind;
  readonly seconds: number;
}

/** Box breathing 4-4-4-4 and the relaxing 4-7-8 (docs/modules/health.md). */
export const breathePhases: Readonly<Record<BreathePattern, readonly BreathPhase[]>> = {
  box: [
    { kind: 'inhale', seconds: 4 },
    { kind: 'hold', seconds: 4 },
    { kind: 'exhale', seconds: 4 },
    { kind: 'hold', seconds: 4 },
  ],
  relax: [
    { kind: 'inhale', seconds: 4 },
    { kind: 'hold', seconds: 7 },
    { kind: 'exhale', seconds: 8 },
  ],
};

export const breathPhaseKey: Readonly<Record<BreathPhaseKind, MessageKey>> = {
  inhale: 'health.flow.breathe.inhale',
  hold: 'health.flow.breathe.hold',
  exhale: 'health.flow.breathe.exhale',
};

/** The pattern's rhythm as the card and the settings row print it ("4-4-4-4"). */
export const breatheRhythm = (pattern: BreathePattern): string =>
  breathePhases[pattern].map((phase) => phase.seconds).join('-');

/** The breathing circle at a full inhale, and how far it shrinks on the exhale. */
export const BREATH_MAX_SCALE = 1;
export const BREATH_MIN_SCALE = 0.55;

/**
 * The circle's size at the end of phase `index`: full after an inhale, small after an exhale,
 * and a hold keeps whatever the phase before it reached.
 */
export const breathTargetScale = (pattern: BreathePattern, index: number): number => {
  const phases = breathePhases[pattern];
  for (let at = index; at >= 0; at -= 1) {
    const kind = phases[at]?.kind;
    if (kind === 'inhale') return BREATH_MAX_SCALE;
    if (kind === 'exhale') return BREATH_MIN_SCALE;
  }
  // A hold before any inhale (never in the shipped patterns) starts from the exhaled size.
  return BREATH_MIN_SCALE;
};

/** One full round of the pattern, in ms. */
export const breatheCycleMs = (pattern: BreathePattern): number =>
  breathePhases[pattern].reduce((sum, phase) => sum + phase.seconds, 0) * SECOND_MS;

export interface BreathPosition {
  readonly phase: BreathPhase;
  /** Index of `phase` within the pattern. */
  readonly index: number;
  /** How far into `phase`, in ms. */
  readonly intoMs: number;
  /** The round in progress, 1-based, and how many the flow has. */
  readonly round: number;
  readonly rounds: number;
}

/** Where in the breathing pattern `elapsedMs` of a `totalMs` flow lands. */
export const breathPositionAt = (
  pattern: BreathePattern,
  elapsedMs: number,
  totalMs: number,
): BreathPosition => {
  const phases = breathePhases[pattern];
  const cycle = breatheCycleMs(pattern);
  const rounds = Math.max(1, Math.round(totalMs / cycle));
  const clamped = Math.min(Math.max(0, elapsedMs), Math.max(0, totalMs - 1));
  const round = Math.min(rounds, Math.floor(clamped / cycle) + 1);
  let into = clamped % cycle;
  for (const [index, phase] of phases.entries()) {
    const length = phase.seconds * SECOND_MS;
    if (into < length) return { phase, index, intoMs: into, round, rounds };
    into -= length;
  }
  const last = phases.length - 1;
  // Unreachable while the phases sum to the cycle; keeps the return total for the checker.
  return {
    phase: phases[last] ?? { kind: 'hold', seconds: 0 },
    index: last,
    intoMs: 0,
    round,
    rounds,
  };
};

/**
 * The flow countdown, sitting time and time to the next reminder, `elapsed` ms after the
 * snapshot arrived. Everything is clamped so a stale snapshot never shows negative time.
 */
export interface HealthClock {
  readonly sittingMs: number;
  readonly nextBreakInMs: number | null;
  readonly flowRemainingMs: number | null;
  readonly flowElapsedMs: number | null;
}

export const clockAt = (snapshot: HealthSnapshot, elapsedMs: number): HealthClock => {
  const elapsed = Math.max(0, elapsedMs);
  const counting = snapshot.sitting === 'sitting';
  const sittingMs = counting ? snapshot.sittingMs + elapsed : snapshot.sittingMs;
  const nextBreakInMs =
    snapshot.nextBreakInMs === null || !counting
      ? snapshot.nextBreakInMs
      : Math.max(0, snapshot.nextBreakInMs - elapsed);
  const flowRemainingMs =
    snapshot.flow === null ? null : Math.max(0, snapshot.flow.remainingMs - elapsed);
  const flowElapsedMs =
    snapshot.flow === null || flowRemainingMs === null
      ? null
      : Math.max(0, snapshot.flow.totalMs - flowRemainingMs);
  return { sittingMs, nextBreakInMs, flowRemainingMs, flowElapsedMs };
};

/** Whether anything on screen changes with the seconds: a sit counting up or a flow running. */
export const clockRuns = (snapshot: HealthSnapshot | null): boolean =>
  snapshot !== null && (snapshot.sitting === 'sitting' || snapshot.flow !== null);
