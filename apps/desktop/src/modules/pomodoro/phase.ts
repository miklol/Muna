import type { PomodoroPhase, PomodoroState } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import type { Tint } from '@muna/ui';

type PhaseKey = Extract<MessageKey, `pomodoro.phase.${string}`>;

/** The phase names the panel shows (`pomodoro.phase.*`). */
export const phaseKey: Readonly<Record<PomodoroPhase, PhaseKey>> = {
  work: 'pomodoro.phase.work',
  shortBreak: 'pomodoro.phase.shortBreak',
  longBreak: 'pomodoro.phase.longBreak',
};

/** Focus is the warm accent, breaks are green (docs/05-design-system.md#colour). */
export const phaseTint = (phase: PomodoroPhase): Tint => (phase === 'work' ? 'orange' : 'green');

/** Every phase, in cycle order, for the preset control. */
export const PHASES: readonly PomodoroPhase[] = ['work', 'shortBreak', 'longBreak'];

/**
 * Time left right now from a state and when it arrived: a running timer counts down from the
 * published value, anything else shows it as is. Never negative.
 */
export const remainingAt = (state: PomodoroState, receivedAt: number, now: number): number =>
  state.status === 'running'
    ? Math.max(0, state.remainingMs - Math.max(0, now - receivedAt))
    : state.remainingMs;
