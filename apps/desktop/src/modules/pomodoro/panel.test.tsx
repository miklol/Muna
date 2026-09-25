import type { PomodoroCommand, PomodoroState } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { PomodoroPanel } from './panel';
import { phaseTint, remainingAt } from './phase';
import { usePomodoroStore } from './pomodoro-store';

type Listener<T> = (event: { payload: T }) => void;

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ state: PomodoroState }>[] = [];
  return {
    getPomodoroSnapshot: vi.fn<() => Promise<PomodoroState>>(),
    pomodoroCommand: vi.fn<(command: PomodoroCommand) => Promise<PomodoroState>>(),
    listen: vi.fn((callback: Listener<{ state: PomodoroState }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (state: PomodoroState) => {
      for (const listener of [...listeners]) listener({ payload: { state } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getPomodoroSnapshot: ipc.getPomodoroSnapshot,
    pomodoroCommand: ipc.pomodoroCommand,
  },
  events: {
    pomodoroStateChanged: { listen: ipc.listen },
  },
}));

const MINUTE = 60_000;

const idle = (overrides: Partial<PomodoroState> = {}): PomodoroState => ({
  phase: 'work',
  status: 'idle',
  remainingMs: 25 * MINUTE,
  totalMs: 25 * MINUTE,
  completedInCycle: 0,
  cycleLength: 4,
  sessionsToday: 0,
  lastFinished: null,
  ...overrides,
});

const running = (overrides: Partial<PomodoroState> = {}): PomodoroState =>
  idle({ status: 'running', remainingMs: 24 * MINUTE + 59_000, ...overrides });

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <PomodoroPanel />
    </I18nextProvider>,
  );

/** Lets the snapshot promise settle. */
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

const countdown = () => document.querySelector('.pomodoro-countdown')?.textContent;

describe('pomodoro helpers', () => {
  it('tints focus warm and breaks green', () => {
    expect(phaseTint('work')).toBe('orange');
    expect(phaseTint('shortBreak')).toBe('green');
    expect(phaseTint('longBreak')).toBe('green');
  });

  it('counts down only while running and never below zero', () => {
    expect(remainingAt(running({ remainingMs: 10_000 }), 1_000, 4_000)).toBe(7_000);
    expect(remainingAt(running({ remainingMs: 10_000 }), 1_000, 20_000)).toBe(0);
    expect(remainingAt(idle({ status: 'paused', remainingMs: 10_000 }), 1_000, 20_000)).toBe(
      10_000,
    );
    // A snapshot stamped in the future (clock skew between store and test) counts from now.
    expect(remainingAt(running({ remainingMs: 10_000 }), 5_000, 4_000)).toBe(10_000);
  });
});

describe('PomodoroPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T09:00:00Z'));
    usePomodoroStore.setState({ state: null, receivedAt: 0 });
    ipc.getPomodoroSnapshot.mockReset().mockResolvedValue(idle());
    ipc.pomodoroCommand.mockReset().mockImplementation((command) => {
      switch (command.kind) {
        case 'start':
          return Promise.resolve(running({ remainingMs: 25 * MINUTE }));
        case 'pause':
          return Promise.resolve(idle({ status: 'paused', remainingMs: 20 * MINUTE }));
        case 'resume':
          return Promise.resolve(running({ remainingMs: 20 * MINUTE }));
        case 'reset':
          return Promise.resolve(idle());
        case 'skip':
          return Promise.resolve(
            idle({ phase: 'shortBreak', remainingMs: 5 * MINUTE, totalMs: 5 * MINUTE }),
          );
        case 'select':
          return Promise.resolve(
            idle({ phase: command.phase, remainingMs: 15 * MINUTE, totalMs: 15 * MINUTE }),
          );
      }
    });
    ipc.listen.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the snapshot: a full idle ring, the phase, no sessions and a start button', async () => {
    renderPanel();
    await flush();
    expect(ipc.getPomodoroSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Focus' })).toBeInTheDocument();
    expect(screen.getByText('No sessions today')).toBeInTheDocument();
    expect(countdown()).toBe('25:00');
    const ring = screen.getByRole('meter', { name: 'Focus' });
    expect(ring).toHaveAttribute('aria-valuenow', String(25 * MINUTE));
    expect(ring).toHaveAttribute('aria-valuemax', String(25 * MINUTE));
    expect(ring).toHaveAttribute('aria-valuetext', 'Focus, 25:00');
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled();
    // Presets are live while idle.
    const presets = screen.getByRole('radiogroup', { name: 'Phase' });
    expect(within(presets).getByRole('radio', { name: 'Focus' })).toBeChecked();
    expect(within(presets).getByRole('radio', { name: 'Long break' })).toBeEnabled();
    expect(screen.getByRole('list', { name: '0 of 4 focus phases before the long break' }));
  });

  it('counts down once a second while running, from the published value', async () => {
    ipc.getPomodoroSnapshot.mockResolvedValue(running({ remainingMs: 90_000 }));
    renderPanel();
    await flush();
    expect(countdown()).toBe('1:30');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(countdown()).toBe('1:29');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(countdown()).toBe('1:25');
    expect(screen.getByRole('meter', { name: 'Focus' })).toHaveAttribute(
      'aria-valuetext',
      'Focus, 1:25 left',
    );
    // Presets and reset follow the status.
    expect(screen.getByRole('radiogroup', { name: 'Phase' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('freezes while paused and subscribes to no clock', async () => {
    ipc.getPomodoroSnapshot.mockResolvedValue(
      idle({ status: 'paused', remainingMs: 90_000, sessionsToday: 2 }),
    );
    renderPanel();
    await flush();
    expect(countdown()).toBe('1:30');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(countdown()).toBe('1:30');
    expect(screen.getByRole('meter', { name: 'Focus' })).toHaveAttribute(
      'aria-valuetext',
      'Focus, 1:30 left, paused',
    );
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByText('2 sessions today')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends the commands and shows the reply at once', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await flush();
    expect(ipc.pomodoroCommand).toHaveBeenLastCalledWith({ kind: 'start', phase: null });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await flush();
    expect(ipc.pomodoroCommand).toHaveBeenLastCalledWith({ kind: 'pause' });
    expect(countdown()).toBe('20:00');

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await flush();
    expect(ipc.pomodoroCommand).toHaveBeenLastCalledWith({ kind: 'resume' });

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await flush();
    expect(ipc.pomodoroCommand).toHaveBeenLastCalledWith({ kind: 'reset' });
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await flush();
    expect(ipc.pomodoroCommand).toHaveBeenLastCalledWith({ kind: 'skip' });
    expect(screen.getByRole('heading', { name: 'Short break' })).toBeInTheDocument();
    expect(countdown()).toBe('5:00');
  });

  it('selects a preset without starting it', async () => {
    renderPanel();
    await flush();
    const presets = screen.getByRole('radiogroup', { name: 'Phase' });
    fireEvent.click(within(presets).getByRole('radio', { name: 'Long break' }));
    await flush();
    expect(ipc.pomodoroCommand).toHaveBeenLastCalledWith({ kind: 'select', phase: 'longBreak' });
    expect(screen.getByRole('heading', { name: 'Long break' })).toBeInTheDocument();
    expect(countdown()).toBe('15:00');
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(document.querySelector('.pomodoro-panel')).toHaveAttribute('data-phase', 'longBreak');
  });

  it('follows PomodoroStateChanged and says what just finished, including while asleep', async () => {
    renderPanel();
    await flush();
    act(() => {
      ipc.emit(
        idle({
          phase: 'shortBreak',
          remainingMs: 5 * MINUTE,
          totalMs: 5 * MINUTE,
          completedInCycle: 1,
          sessionsToday: 1,
          lastFinished: { phase: 'work', whileAsleep: false },
        }),
      );
    });
    expect(screen.getByText('Focus finished')).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: '1 of 4 focus phases before the long break' }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('.pomodoro-cycle__dot[data-done]')).toHaveLength(1);

    act(() => {
      ipc.emit(idle({ sessionsToday: 1, lastFinished: { phase: 'longBreak', whileAsleep: true } }));
    });
    expect(screen.getByText('Long break finished while the PC was asleep')).toBeInTheDocument();
  });

  it('shows long focus phases with hours and a smaller step', async () => {
    ipc.getPomodoroSnapshot.mockResolvedValue(
      idle({ remainingMs: 90 * MINUTE, totalMs: 90 * MINUTE }),
    );
    renderPanel();
    await flush();
    expect(countdown()).toBe('1:30:00');
    expect(document.querySelector('.pomodoro-countdown')).toHaveClass('muna-text--title1');
  });

  it('unlistens on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.listenerCount()).toBe(1);
    view.unmount();
    expect(ipc.listenerCount()).toBe(0);
  });
});
