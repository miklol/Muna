import type { HealthCommand, HealthSnapshot, IpcError, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, writeHealthSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { usePanelHoldStore } from '../../lib/panel-hold';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey } from '../../lib/settings';
import { MINUTE_MS, SECOND_MS } from './format';
import { useHealthStore } from './health-store';
import { HealthPanel } from './panel';
import { emptySnapshot, SAMPLE_NOW_MS, sampleSnapshot } from './sample-snapshot';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ok = <T,>(data: T): IpcResult<T> => ({ status: 'ok', data });

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: HealthSnapshot }>[] = [];
  return {
    getHealthSnapshot: vi.fn<() => Promise<IpcResult<HealthSnapshot>>>(),
    healthCommand: vi.fn<(command: HealthCommand) => Promise<IpcResult<HealthSnapshot>>>(),
    openSettings: vi.fn<() => Promise<void>>(),
    listen: vi.fn((callback: Listener<{ snapshot: HealthSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: HealthSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getHealthSnapshot: ipc.getHealthSnapshot,
    healthCommand: ipc.healthCommand,
    openSettings: ipc.openSettings,
  },
  events: {
    healthChanged: { listen: ipc.listen },
  },
}));

const queryClient = createQueryClient();
queryClient.setQueryDefaults(settingsQueryKey, { gcTime: Number.POSITIVE_INFINITY });

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

const renderPanel = (settings: Settings = defaultSettings()) => {
  cacheSettings(queryClient, settings);
  return render(
    <Providers>
      <HealthPanel />
    </Providers>,
  );
};

const flush = (ms = 50) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const moveFlow = (remainingMs = 180_000): HealthSnapshot['flow'] => ({
  flow: 'move',
  startedMs: SAMPLE_NOW_MS,
  remainingMs,
  totalMs: 180_000,
  pattern: 'box',
});

describe('HealthPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SAMPLE_NOW_MS);
    useHealthStore.setState({ snapshot: null, receivedAt: 0 });
    usePanelHoldStore.setState({ holds: 0 });
    ipc.getHealthSnapshot.mockReset().mockResolvedValue(ok(sampleSnapshot()));
    ipc.healthCommand.mockReset().mockImplementation((command) => {
      const base = sampleSnapshot();
      switch (command.kind) {
        case 'water':
          return Promise.resolve(
            ok(
              sampleSnapshot({ today: { ...base.today, water: base.today.water + command.delta } }),
            ),
          );
        case 'startFlow':
          return Promise.resolve(
            ok(
              sampleSnapshot({
                breakDueSinceMs: null,
                nextBreakInMs: null,
                flow: {
                  flow: command.flow,
                  startedMs: SAMPLE_NOW_MS,
                  remainingMs: command.flow === 'eyeRest' ? 20_000 : 128_000,
                  totalMs: command.flow === 'eyeRest' ? 20_000 : 128_000,
                  pattern: 'box',
                },
              }),
            ),
          );
        case 'snooze':
          return Promise.resolve(
            ok(sampleSnapshot({ breakDueSinceMs: null, nextBreakInMs: 10 * MINUTE_MS })),
          );
        default:
          return Promise.resolve(ok(sampleSnapshot({ breakDueSinceMs: null, flow: null })));
      }
    });
    ipc.openSettings.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('subscribes on mount, paints the first snapshot, follows changes and unlistens on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.getHealthSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);
    expect(screen.getByRole('heading', { name: 'Sitting for 34 min' })).toBeInTheDocument();
    expect(screen.getByLabelText('Next break in 16 min')).toHaveTextContent('16 min');

    act(() => {
      ipc.emit(
        sampleSnapshot({
          sittingMs: 52 * MINUTE_MS,
          nextBreakInMs: null,
          breakDueSinceMs: SAMPLE_NOW_MS,
        }),
      );
    });
    expect(screen.getByRole('heading', { name: 'Sitting for 52 min' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Time for a break');

    view.unmount();
    // Motion's frame loop parks its last animation frame; let it settle before counting timers.
    await flush();
    expect(ipc.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows today, the three rings with the week and the counters, and the four flows', async () => {
    renderPanel();
    await flush();
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('Active').nextElementSibling).toHaveTextContent('5 h 12 min');
    expect(within(today).getByText('Longest sit').nextElementSibling).toHaveTextContent('58 min');
    expect(within(today).getByText('Breaks').nextElementSibling).toHaveTextContent('4');
    expect(within(today).getByText('Mindful').nextElementSibling).toHaveTextContent('0 min');
    expect(within(today).getByText('1-day streak')).toBeInTheDocument();

    const goals = screen.getByRole('region', { name: 'Goals' });
    expect(within(goals).getByRole('meter', { name: 'Breaks' })).toHaveAttribute(
      'aria-valuetext',
      '4 of 7 breaks',
    );
    expect(within(goals).getByRole('meter', { name: 'Water' })).toHaveAttribute(
      'aria-valuetext',
      '7 of 8 glasses',
    );
    expect(within(goals).getByRole('meter', { name: 'Mindful' })).toHaveAttribute(
      'aria-valuetext',
      '0 of 10 mindful minutes',
    );
    const week = within(goals).getByRole('list', { name: 'Last 7 days' });
    const days = within(week).getAllByRole('listitem');
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAttribute('aria-label', 'Wed, 3 of 3 goals met');
    expect(days[4]).toHaveAttribute('aria-label', 'Sun, 0 of 3 goals met');
    expect(days[6]).toHaveAttribute('aria-label', 'Today, 0 of 3 goals met');
    expect(days[6]).toHaveAttribute('data-today');

    const flows = screen.getByRole('region', { name: 'Take a break' });
    expect(
      within(flows)
        .getAllByRole('button')
        .map((card) => card.getAttribute('aria-label')),
    ).toEqual(['Start Move', 'Start Breathe', 'Start Stretch', 'Start Eye rest']);
    expect(within(flows).getByText('4-4-4-4')).toBeInTheDocument();
  });

  it('prints the breathing rhythm the settings pick on the Breathe card', async () => {
    renderPanel(
      writeHealthSettings(defaultSettings(), {
        enabled: true,
        breakEveryMin: 50,
        waterGoal: 8,
        windDownHour: null,
        hearingWarning: true,
        breathePattern: 'relax',
      }),
    );
    await flush();
    expect(screen.getByText('4-7-8')).toBeInTheDocument();
  });

  it('counts the sit up and the reminder down once a second while sitting, and not while away', async () => {
    renderPanel();
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * SECOND_MS);
    });
    expect(screen.getByRole('heading', { name: 'Sitting for 35 min' })).toBeInTheDocument();
    expect(screen.getByLabelText('Next break in 15 min')).toBeInTheDocument();

    act(() => {
      ipc.emit(sampleSnapshot({ sitting: 'away', nextBreakInMs: null }));
    });
    expect(screen.getByRole('heading', { name: 'Away from the desk' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * MINUTE_MS);
    });
    expect(screen.getByRole('heading', { name: 'Away from the desk' })).toBeInTheDocument();
  });

  it('logs water with the − and + buttons and shows the reply at once', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Add a glass of water' }));
    await flush();
    expect(ipc.healthCommand).toHaveBeenCalledWith({ kind: 'water', delta: 1 });
    expect(screen.getByRole('meter', { name: 'Water' })).toHaveAttribute(
      'aria-valuetext',
      '8 of 8 glasses',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove a glass of water' }));
    await flush();
    expect(ipc.healthCommand).toHaveBeenLastCalledWith({ kind: 'water', delta: -1 });
  });

  it('starts a flow from its card, holds the panel, counts it down and stops it', async () => {
    renderPanel();
    await flush();
    expect(usePanelHoldStore.getState().holds).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Start Move' }));
    await flush();
    expect(ipc.healthCommand).toHaveBeenCalledWith({ kind: 'startFlow', flow: 'move' });
    expect(usePanelHoldStore.getState().holds).toBe(1);
    expect(screen.getByRole('heading', { name: 'Move' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Move' })).toHaveAttribute(
      'aria-valuetext',
      'Move, 2:08 left',
    );
    expect(screen.getByText('Stand up and walk a few steps')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Goals' })).not.toBeInTheDocument();

    // The reply landed a few ms after the clock's ticks, so the whole seconds are floored:
    // 31 s later the tick reads 30 s elapsed, the second prompt slice.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31 * SECOND_MS);
    });
    expect(screen.getByRole('meter', { name: 'Move' })).toHaveAttribute(
      'aria-valuetext',
      'Move, 1:38 left',
    );
    expect(screen.getByText('Roll your shoulders back, slowly')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await flush();
    expect(ipc.healthCommand).toHaveBeenLastCalledWith({ kind: 'stopFlow' });
    expect(usePanelHoldStore.getState().holds).toBe(0);
    expect(screen.getByRole('region', { name: 'Goals' })).toBeInTheDocument();
  });

  it('guides the other flows: the breathing circle, the stretch steps and the eye rest', async () => {
    ipc.getHealthSnapshot.mockResolvedValue(
      ok(
        sampleSnapshot({
          nextBreakInMs: null,
          flow: {
            flow: 'breathe',
            startedMs: SAMPLE_NOW_MS,
            remainingMs: 114_000,
            totalMs: 114_000,
            pattern: 'relax',
          },
        }),
      ),
    );
    renderPanel();
    await flush();
    expect(screen.getByText('Breathe in')).toBeInTheDocument();
    expect(screen.getByText('Round 1 of 6')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * SECOND_MS);
    });
    expect(screen.getByText('Hold')).toBeInTheDocument();

    act(() => {
      ipc.emit(
        sampleSnapshot({
          nextBreakInMs: null,
          flow: {
            flow: 'stretch',
            startedMs: SAMPLE_NOW_MS,
            remainingMs: 90_000,
            totalMs: 120_000,
            pattern: 'box',
          },
        }),
      );
    });
    const steps = within(screen.getByRole('list', { name: 'Stretch' })).getAllByRole('listitem');
    expect(steps).toHaveLength(6);
    expect(steps[0]).toHaveAttribute('data-done');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toHaveTextContent('Shoulders: roll them back five times');

    act(() => {
      ipc.emit(
        sampleSnapshot({
          nextBreakInMs: null,
          flow: {
            flow: 'eyeRest',
            startedMs: SAMPLE_NOW_MS,
            remainingMs: 20_000,
            totalMs: 20_000,
            pattern: 'box',
          },
        }),
      );
    });
    expect(
      screen.getByText('Look at something far away, about 20 feet, until the timer ends.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Eye rest' })).toHaveAttribute(
      'aria-valuetext',
      'Eye rest, 0:20 left',
    );
  });

  it('leads the flows with the reminder while a break is due, with snooze and dismiss', async () => {
    ipc.getHealthSnapshot.mockResolvedValue(
      ok(
        sampleSnapshot({
          sittingMs: 52 * MINUTE_MS,
          nextBreakInMs: null,
          breakDueSinceMs: SAMPLE_NOW_MS,
        }),
      ),
    );
    renderPanel();
    await flush();
    const reminder = screen.getByRole('status');
    expect(reminder).toHaveTextContent('Time for a break');
    expect(reminder).toHaveTextContent(
      'Sitting for 52 min. Pick a flow, or stand up for a moment.',
    );
    fireEvent.click(within(reminder).getByRole('button', { name: 'Snooze' }));
    await flush();
    expect(ipc.healthCommand).toHaveBeenCalledWith({ kind: 'snooze' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Next break in 10 min')).toBeInTheDocument();

    act(() => {
      ipc.emit(sampleSnapshot({ nextBreakInMs: null, breakDueSinceMs: SAMPLE_NOW_MS }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await flush();
    expect(ipc.healthCommand).toHaveBeenLastCalledWith({ kind: 'dismiss' });
  });

  it('says why the timer is paused, warns about loud headphones and points off to Settings', async () => {
    ipc.getHealthSnapshot.mockResolvedValue(
      ok(
        sampleSnapshot({
          sitting: 'locked',
          nextBreakInMs: null,
          hearing: { percent: 90, loudForMs: 12 * MINUTE_MS, warned: true },
          windingDown: true,
        }),
      ),
    );
    renderPanel();
    await flush();
    expect(screen.getByRole('heading', { name: 'Locked' })).toBeInTheDocument();
    expect(screen.getByText('Winding down')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loud on headphones: 90 % for 12 min. Turn it down a little.',
    );

    act(() => {
      ipc.emit(emptySnapshot({ sitting: 'off', enabled: false, nextBreakInMs: null }));
    });
    expect(screen.getByRole('heading', { name: 'Health is off' })).toBeInTheDocument();
    expect(
      screen.getByText('Turn it on in Settings to track sitting and get break reminders.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Goals' })).not.toBeInTheDocument();
  });

  it('opens Settings from the head', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
  });

  it('renders nothing until the first snapshot arrives', () => {
    ipc.getHealthSnapshot.mockReturnValue(new Promise(() => undefined));
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the hold only while a flow runs, even across snapshots', async () => {
    ipc.getHealthSnapshot.mockResolvedValue(ok(sampleSnapshot({ flow: moveFlow() })));
    const view = renderPanel();
    await flush();
    expect(usePanelHoldStore.getState().holds).toBe(1);
    act(() => {
      ipc.emit(sampleSnapshot({ flow: moveFlow(100_000) }));
    });
    expect(usePanelHoldStore.getState().holds).toBe(1);
    view.unmount();
    expect(usePanelHoldStore.getState().holds).toBe(0);
  });
});
