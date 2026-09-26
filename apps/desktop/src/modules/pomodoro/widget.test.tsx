import type { PomodoroCommand, PomodoroState } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { usePomodoroStore } from './pomodoro-store';
import { PomodoroWidget } from './widget';

const ipc = vi.hoisted(() => ({
  getPomodoroSnapshot: vi.fn(() => new Promise<never>(() => undefined)),
  pomodoroCommand: vi.fn<(command: PomodoroCommand) => Promise<PomodoroState>>(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getPomodoroSnapshot: ipc.getPomodoroSnapshot,
    pomodoroCommand: ipc.pomodoroCommand,
  },
  events: { pomodoroStateChanged: { listen: ipc.listen } },
}));

const MINUTE = 60_000;

const idle = (overrides: Partial<PomodoroState> = {}): PomodoroState => ({
  phase: 'work',
  status: 'idle',
  remainingMs: 25 * MINUTE,
  totalMs: 25 * MINUTE,
  completedInCycle: 0,
  cycleLength: 4,
  sessionsToday: 2,
  lastFinished: null,
  ...overrides,
});

const running = (overrides: Partial<PomodoroState> = {}): PomodoroState =>
  idle({ status: 'running', remainingMs: 24 * MINUTE + 59_000, ...overrides });

const renderWidget = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <PomodoroWidget span={1} />
    </I18nextProvider>,
  );

const countdown = () => document.querySelector('.pomodoro-countdown')?.textContent;

describe('PomodoroWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T09:00:00Z'));
    usePomodoroStore.setState({ state: null, receivedAt: 0 });
    ipc.pomodoroCommand
      .mockReset()
      .mockImplementation((command) =>
        Promise.resolve(
          command.kind === 'start'
            ? running({ remainingMs: 25 * MINUTE })
            : idle({ status: 'paused', remainingMs: 20 * MINUTE }),
        ),
      );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the idle dial, the phase, the sessions today and a start button', () => {
    usePomodoroStore.getState().setState(idle(), Date.now());
    renderWidget();
    expect(countdown()).toBe('25:00');
    expect(screen.getByText('Focus')).toBeInTheDocument();
    expect(screen.getByText('2 sessions today')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Focus' })).toHaveAttribute(
      'aria-valuetext',
      'Focus, 25:00',
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('starts, then counts down once a second while running and offers pause', async () => {
    usePomodoroStore.getState().setState(idle(), Date.now());
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(ipc.pomodoroCommand).toHaveBeenCalledWith({ kind: 'start', phase: null });
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(countdown()).toBe('25:00');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(countdown()).toBe('24:58');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops ticking when unmounted', async () => {
    usePomodoroStore.getState().setState(running(), Date.now());
    const view = renderWidget();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
