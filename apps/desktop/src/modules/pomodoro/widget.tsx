import { commands, type PomodoroCommand } from '@muna/contracts';
import { formatCountdown, IconButton, Ring, Text } from '@muna/ui';
import { Pause, Play } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { phaseKey, phaseTint } from './phase';
import { usePomodoroStore } from './pomodoro-store';
import './pomodoro.css';
import { useCountdown } from './use-countdown';
import { usePomodoroSubscription } from './use-pomodoro';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The card's dial: small enough for the 12 px digits to sit inside the 3 px stroke. */
export const WIDGET_RING_DIAMETER = 56;

/**
 * The pomodoro card on the dashboard (docs/modules/dashboard.md "Widgets": Pomodoro card): the
 * dial with the countdown, the phase name, what the timer is doing, and start/pause. The digits
 * count down once a second only while running and mounted, exactly like the panel.
 */
export function PomodoroWidget(_props: WidgetProps) {
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
  const statusLine = running
    ? t('pomodoro.widget.running')
    : idle
      ? t('pomodoro.sessionsToday', { count: state.sessionsToday })
      : t('pomodoro.widget.paused');
  const primary: { label: string; command: PomodoroCommand } = running
    ? { label: t('pomodoro.pause'), command: { kind: 'pause' } }
    : idle
      ? { label: t('pomodoro.start'), command: { kind: 'start', phase: null } }
      : { label: t('pomodoro.resume'), command: { kind: 'resume' } };

  return (
    <div className="pomodoro-widget" data-phase={phase} data-status={status}>
      <Ring
        className="pomodoro-widget__ring"
        diameter={WIDGET_RING_DIAMETER}
        size="small"
        tint={phaseTint(phase)}
        aria-label={phaseName}
        value={left}
        minValue={0}
        maxValue={Math.max(1, state.totalMs)}
        valueText={ringText}
      >
        <Text
          as="time"
          variant="caption"
          weight={600}
          tabular
          className="pomodoro-countdown"
          data-running={running || undefined}
        >
          {remaining}
        </Text>
      </Ring>
      <div className="pomodoro-widget__text">
        <Text as="span" variant="footnote" weight={600} truncate={1}>
          {phaseName}
        </Text>
        <Text as="span" variant="caption" tone="secondary" truncate={1}>
          {statusLine}
        </Text>
      </div>
      <IconButton
        aria-label={primary.label}
        className="pomodoro-widget__play"
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
    </div>
  );
}
