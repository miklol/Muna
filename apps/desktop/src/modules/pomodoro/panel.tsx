import { commands, type PomodoroCommand, type PomodoroPhase } from '@muna/contracts';
import {
  formatCountdown,
  IconButton,
  Ring,
  SegmentedControl,
  type SegmentedControlItem,
  Text,
} from '@muna/ui';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { PHASES, phaseKey, phaseTint } from './phase';
import { usePomodoroStore } from './pomodoro-store';
import './pomodoro.css';
import { useCountdown } from './use-countdown';
import { usePomodoroSubscription } from './use-pomodoro';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** Outer diameter of the dial; the display digits fit inside with the 8 px stroke. */
export const RING_DIAMETER = 144;

const HOUR_MS = 3_600_000;

interface CycleDotsProps {
  done: number;
  total: number;
  label: string;
}

/** One dot per focus phase in the cycle, filled as they complete; spoken as one sentence. */
function CycleDots({ done, total, label }: CycleDotsProps) {
  return (
    <ul className="pomodoro-cycle" aria-label={label}>
      {Array.from({ length: total }, (_, index) => (
        <li key={index} className="pomodoro-cycle__dot" data-done={index < done || undefined} />
      ))}
    </ul>
  );
}

/**
 * The pomodoro panel (docs/modules/pomodoro.md, docs/reference/ui-observations.md
 * "Pomodoro"): the dial on the left — reset, the ring with the countdown in display digits
 * tinted by phase, skip — and on the right the phase name, a status line (sessions today, or
 * what just finished), the presets and the start/pause button with the cycle dots. The ring
 * and digits count down locally once a second only while running and mounted; Rust owns the
 * time and republishes the exact value once a minute.
 */
export function PomodoroPanel() {
  const { t } = useTranslation();
  usePomodoroSubscription();
  const state = usePomodoroStore((store) => store.state);
  const receivedAt = usePomodoroStore((store) => store.receivedAt);
  const setState = usePomodoroStore((store) => store.setState);
  const left = useCountdown(state, receivedAt);

  const send = useCallback(
    (command: PomodoroCommand) => {
      void commands
        .pomodoroCommand(command)
        .then((next) => {
          // The reply is the state after the command; the event that follows says the same.
          setState(next);
        })
        .catch(() => {
          // Outside Tauri (tests, Storybook) the seeded state stands.
        });
    },
    [setState],
  );

  if (state === null) return null;

  const { phase, status } = state;
  const idle = status === 'idle';
  const running = status === 'running';
  const phaseName = t(phaseKey[phase]);
  const remaining = formatCountdown(left);
  const ringText = idle
    ? t('pomodoro.ringIdle', { phase: phaseName, total: formatCountdown(state.totalMs) })
    : t(running ? 'pomodoro.ring' : 'pomodoro.ringPaused', { phase: phaseName, remaining });
  const statusLine =
    state.lastFinished === null
      ? t('pomodoro.sessionsToday', { count: state.sessionsToday })
      : t(state.lastFinished.whileAsleep ? 'pomodoro.finishedAsleep' : 'pomodoro.finished', {
          phase: t(phaseKey[state.lastFinished.phase]),
        });
  const presets: SegmentedControlItem<PomodoroPhase>[] = PHASES.map((id) => ({
    id,
    label: t(phaseKey[id]),
  }));
  const primary: { label: string; command: PomodoroCommand } = running
    ? { label: t('pomodoro.pause'), command: { kind: 'pause' } }
    : idle
      ? { label: t('pomodoro.start'), command: { kind: 'start', phase: null } }
      : { label: t('pomodoro.resume'), command: { kind: 'resume' } };

  return (
    <div className="pomodoro-panel" data-phase={phase} data-status={status}>
      <div className="pomodoro-dial">
        <IconButton
          aria-label={t('pomodoro.reset')}
          isDisabled={idle}
          onPress={() => {
            send({ kind: 'reset' });
          }}
        >
          <RotateCcw strokeWidth={ICON_STROKE} />
        </IconButton>
        <Ring
          className="pomodoro-ring"
          diameter={RING_DIAMETER}
          tint={phaseTint(phase)}
          aria-label={phaseName}
          value={left}
          minValue={0}
          maxValue={Math.max(1, state.totalMs)}
          valueText={ringText}
        >
          <Text
            as="time"
            variant={left >= HOUR_MS ? 'title1' : 'display'}
            tabular
            className="pomodoro-countdown"
            data-running={running || undefined}
          >
            {remaining}
          </Text>
        </Ring>
        <IconButton
          aria-label={t('pomodoro.skip')}
          onPress={() => {
            send({ kind: 'skip' });
          }}
        >
          <SkipForward strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      <div className="pomodoro-details">
        <div className="pomodoro-meta">
          <Text as="h2" variant="title3" className="pomodoro-phase">
            {phaseName}
          </Text>
          <Text as="p" variant="footnote" tone="secondary" className="pomodoro-status">
            {statusLine}
          </Text>
        </div>
        <SegmentedControl
          aria-label={t('pomodoro.presets')}
          className="pomodoro-presets"
          items={presets}
          value={phase}
          isDisabled={!idle}
          onChange={(next) => {
            send({ kind: 'select', phase: next });
          }}
        />
        <div className="pomodoro-actions">
          <IconButton
            aria-label={primary.label}
            size="large"
            className="pomodoro-play"
            onPress={() => {
              send(primary.command);
            }}
          >
            {running ? (
              <Pause strokeWidth={ICON_STROKE} fill="currentColor" />
            ) : (
              <Play strokeWidth={ICON_STROKE} fill="currentColor" />
            )}
          </IconButton>
          <CycleDots
            done={state.completedInCycle}
            total={state.cycleLength}
            label={t('pomodoro.cycle', { done: state.completedInCycle, total: state.cycleLength })}
          />
        </div>
      </div>
    </div>
  );
}
