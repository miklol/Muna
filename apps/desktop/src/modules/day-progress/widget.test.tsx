import type { IpcError, PomodoroState, Settings, Task, TodoSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultDayProgressSettings,
  defaultSettings,
  writeDayProgressSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey } from '../../lib/settings';
import { atMinutes, MINUTE_MS, startOfDay } from './timeline';
import { DayProgressWidget } from './widget';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  getTodoSnapshot: vi.fn<() => Promise<IpcResult<TodoSnapshot>>>(),
  getPomodoroSnapshot: vi.fn<() => Promise<PomodoroState>>(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getTodoSnapshot: ipc.getTodoSnapshot,
    getPomodoroSnapshot: ipc.getPomodoroSnapshot,
  },
  events: {
    todoChanged: { listen: ipc.listen },
    pomodoroStateChanged: { listen: ipc.listen },
  },
}));

/** A Tuesday at 13:30 local time, halfway through the default 09:00–18:00 working day. */
const now = new Date(2026, 2, 10, 13, 30);
const day = startOfDay(now);
const at = (hours: number, minutes = 0): number => atMinutes(day, hours * 60 + minutes);

const task = (overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
  listId: 'inbox',
  notes: '',
  dueMs: null,
  allDay: false,
  completedAtMs: null,
  deletedAtMs: null,
  sortOrder: 0,
  createdAtMs: at(8),
  updatedAtMs: at(8),
  ...overrides,
});

const snapshot = (tasks: Task[]): TodoSnapshot => ({
  lists: [{ id: 'inbox', name: null, sortOrder: 0 }],
  tasks,
  retentionDays: 30,
});

const idle: PomodoroState = {
  phase: 'work',
  status: 'idle',
  remainingMs: 25 * MINUTE_MS,
  totalMs: 25 * MINUTE_MS,
  completedInCycle: 0,
  cycleLength: 4,
  sessionsToday: 0,
  lastFinished: null,
};

const queryClient = createQueryClient();
// Keep TanStack's garbage-collection timeout out of the timer count so the assertion below
// sees only the widget's own minute tick.
queryClient.setQueryDefaults(settingsQueryKey, { gcTime: Number.POSITIVE_INFINITY });

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

const renderWidget = (settings: Settings = defaultSettings()) => {
  cacheSettings(queryClient, settings);
  return render(
    <Providers>
      <DayProgressWidget span={1} />
    </Providers>,
  );
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('DayProgressWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    queryClient.clear();
    ipc.getTodoSnapshot.mockReset().mockResolvedValue({ status: 'ok', data: snapshot([]) });
    ipc.getPomodoroSnapshot.mockReset().mockResolvedValue(idle);
  });

  afterEach(async () => {
    cleanup();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  it('shows how far the working day has come and the completion count', async () => {
    ipc.getTodoSnapshot.mockResolvedValue({
      status: 'ok',
      data: snapshot([
        task({ id: 'standup', title: 'Standup', dueMs: at(10), completedAtMs: at(10, 5) }),
        task({ id: 'review', title: 'Review', dueMs: at(16) }),
      ]),
    });
    renderWidget();
    await flush();
    expect(screen.getByText('Working day')).toBeInTheDocument();
    expect(screen.getByText('50% over')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Share of the working day that has passed' }),
    ).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('says when the day has not started and when it is over, and ticks once a minute', async () => {
    const late = writeDayProgressSettings(defaultSettings(), {
      ...defaultDayProgressSettings(),
      workStartMinutes: 15 * 60,
      workEndMinutes: 20 * 60,
    });
    const view = renderWidget(late);
    await flush();
    expect(screen.getByText('Starts at 3:00 PM')).toBeInTheDocument();
    expect(screen.getByText('No timed tasks yet')).toBeInTheDocument();
    view.unmount();

    vi.setSystemTime(new Date(2026, 2, 10, 18, 30));
    renderWidget();
    await flush();
    expect(screen.getByText('Over for today')).toBeInTheDocument();

    vi.setSystemTime(new Date(2026, 2, 10, 17, 59, 30));
    cleanup();
    renderWidget();
    await flush();
    expect(screen.getByText('99% over')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(screen.getByText('Over for today')).toBeInTheDocument();
  });

  it('clears its minute tick when unmounted', async () => {
    const view = renderWidget();
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    // Lets the unlisten promises and the query cache's batched notification settle.
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });
});
