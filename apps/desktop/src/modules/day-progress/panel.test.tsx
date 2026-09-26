import type { IpcError, PomodoroState, Settings, Task, TodoSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultDayProgressSettings,
  defaultSettings,
  writeDayProgressSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey } from '../../lib/settings';
import { useAppStore } from '../../store/app-store';
import { DayProgressPanel, formatDuration, timelineRows } from './panel';
import { atMinutes, buildTimeline, MINUTE_MS, startOfDay } from './timeline';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => {
  const channel = <T,>() => {
    const listeners: Listener<T>[] = [];
    return {
      listen: vi.fn((callback: Listener<T>) => {
        listeners.push(callback);
        return Promise.resolve(() => {
          listeners.splice(listeners.indexOf(callback), 1);
        });
      }),
      emit: (payload: T) => {
        for (const listener of [...listeners]) listener({ payload });
      },
      count: () => listeners.length,
    };
  };
  return {
    getTodoSnapshot: vi.fn<() => Promise<IpcResult<TodoSnapshot>>>(),
    getPomodoroSnapshot: vi.fn<() => Promise<PomodoroState>>(),
    todo: channel<{ snapshot: TodoSnapshot }>(),
    pomodoro: channel<{ state: PomodoroState }>(),
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getTodoSnapshot: ipc.getTodoSnapshot,
    getPomodoroSnapshot: ipc.getPomodoroSnapshot,
  },
  events: {
    todoChanged: { listen: ipc.todo.listen },
    pomodoroStateChanged: { listen: ipc.pomodoro.listen },
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

const focusing = (overrides: Partial<PomodoroState> = {}): PomodoroState => ({
  ...idle,
  status: 'running',
  remainingMs: 20 * MINUTE_MS,
  sessionsToday: 3,
  ...overrides,
});

const standup = task({ id: 'standup', title: 'Standup', dueMs: at(10), completedAtMs: at(10, 5) });
const review = task({ id: 'review', title: 'Review the release notes', dueMs: at(16) });

const queryClient = createQueryClient();
// The settings query would otherwise arm TanStack's garbage-collection timeout when the panel
// unmounts, hiding whether the panel's own minute tick was cleared.
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
      <DayProgressPanel />
    </Providers>,
  );
};

/** Lets the snapshot promises and the query cache's batched notifications run. */
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const rows = () =>
  within(screen.getByRole('region', { name: 'Timeline' })).getAllByRole('listitem');

describe('formatDuration', () => {
  const t = i18n.t.bind(i18n);

  it('spells hours and minutes from the catalog', () => {
    expect(formatDuration(45 * MINUTE_MS, t)).toBe('45 min');
    expect(formatDuration(2 * 60 * MINUTE_MS, t)).toBe('2 h');
    expect(formatDuration(130 * MINUTE_MS, t)).toBe('2 h 10 min');
    expect(formatDuration(0, t)).toBe('0 min');
  });
});

describe('timelineRows', () => {
  it('puts items before the now marker before the free stretch when they share a moment', () => {
    const timeline = buildTimeline({
      tasks: [task({ id: 'now', title: 'Now-ish', dueMs: at(13, 30) })],
      pomodoro: null,
      settings: defaultDayProgressSettings(),
      now,
    });
    // The task is open, so the free stretch begins when the clock stands: at 13:30 as well.
    expect(timeline.gap?.startMs).toBe(at(13, 30));
    expect(timelineRows(timeline, now.getTime()).map((row) => row.kind)).toEqual([
      'item',
      'now',
      'gap',
    ]);
  });
});

describe('DayProgressPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    queryClient.clear();
    useAppStore.setState({ activeModuleId: null });
    ipc.getTodoSnapshot.mockReset().mockResolvedValue({ status: 'ok', data: snapshot([]) });
    ipc.getPomodoroSnapshot.mockReset().mockResolvedValue(idle);
    ipc.todo.listen.mockClear();
    ipc.pomodoro.listen.mockClear();
  });

  afterEach(async () => {
    cleanup();
    // Let Motion's frame loop run the frame it scheduled before the timers go real.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  it('says what to do while nothing is on the timeline, and hands over to the to-do module', async () => {
    renderPanel();
    await flush();
    expect(ipc.getTodoSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.getPomodoroSnapshot).toHaveBeenCalledTimes(1);

    expect(screen.getByText('Nothing on the timeline yet')).toBeInTheDocument();
    expect(screen.getByText('Tuesday, March 10')).toBeInTheDocument();
    expect(screen.getByText('No timed tasks yet')).toBeInTheDocument();
    expect(screen.getByText('50% over')).toBeInTheDocument();
    expect(screen.getByText('0 tasks due')).toBeInTheDocument();
    expect(screen.getByText('0 focus sessions')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Tasks completed today' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    expect(
      screen.getByRole('progressbar', { name: 'Share of the working day that has passed' }),
    ).toHaveAttribute('aria-valuenow', '50');

    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    expect(useAppStore.getState().activeModuleId).toBe('todo');
  });

  it('lists the day around the now marker and hints at the first long free stretch', async () => {
    ipc.getTodoSnapshot.mockResolvedValue({ status: 'ok', data: snapshot([review, standup]) });
    ipc.getPomodoroSnapshot.mockResolvedValue(focusing());
    renderPanel();
    await flush();

    const items = rows();
    expect(items.map((row) => row.getAttribute('data-kind'))).toEqual([
      'item',
      'item',
      'now',
      'gap',
      'item',
    ]);
    expect(items[0]).toHaveTextContent('10:00 AM');
    expect(items[0]).toHaveTextContent('Standup');
    expect(items[0]).toHaveTextContent('Done');
    expect(items[0]).toHaveAttribute('data-done', 'true');
    expect(items[1]).toHaveTextContent('1:25 PM');
    expect(items[1]).toHaveTextContent('Focus');
    expect(items[1]).toHaveTextContent('until 1:50 PM');
    expect(items[2]).toHaveTextContent('1:30 PM');
    expect(items[2]).toHaveTextContent('Now');
    expect(items[2]).toHaveAttribute('aria-current', 'time');
    // The stretch starts when the focus phase ends and runs to the next task.
    expect(items[3]).toHaveTextContent('Long stretch — 2 h 10 min free');
    expect(items[3]).toHaveTextContent('Nothing planned between 1:50 PM and 4:00 PM.');
    expect(items[3]).toContainElement(screen.getByRole('button', { name: 'Add a task' }));
    expect(items[4]).toHaveTextContent('4:00 PM');
    expect(items[4]).toHaveTextContent('Review the release notes');
    expect(items[4]).toHaveTextContent('Due');
    expect(items[4]).not.toHaveAttribute('data-done');

    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('2 tasks due')).toBeInTheDocument();
    expect(screen.getByText('3 focus sessions')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Tasks completed today' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
  });

  it('moves the now marker at the whole minute and follows the sources as they change', async () => {
    ipc.getTodoSnapshot.mockResolvedValue({ status: 'ok', data: snapshot([review]) });
    renderPanel();
    await flush();
    expect(rows().map((row) => row.getAttribute('data-kind'))).toEqual(['now', 'gap', 'item']);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MINUTE_MS);
    });
    expect(rows()[0]).toHaveTextContent('1:31 PM');

    act(() => {
      ipc.todo.emit({
        snapshot: snapshot([
          review,
          task({ id: 'call', title: 'Call the dentist', dueMs: at(13, 45) }),
        ]),
      });
    });
    expect(rows().map((row) => row.getAttribute('data-kind'))).toEqual([
      'now',
      'item',
      'gap',
      'item',
    ]);
    expect(rows()[1]).toHaveTextContent('Call the dentist');
    expect(screen.getByText('2 tasks due')).toBeInTheDocument();

    act(() => {
      ipc.pomodoro.emit({ state: focusing({ status: 'paused', sessionsToday: 1 }) });
    });
    expect(screen.getByText('Focus, paused')).toBeInTheDocument();
    expect(screen.getByText('1 focus session')).toBeInTheDocument();
  });

  it('unlistens and stops ticking on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.todo.count()).toBe(1);
    expect(ipc.pomodoro.count()).toBe(1);

    view.unmount();
    await flush();
    expect(ipc.todo.count()).toBe(0);
    expect(ipc.pomodoro.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hides the to-do shortcut when that module is off', async () => {
    const settings = defaultSettings();
    renderPanel({ ...settings, shell: { ...settings.shell, disabledModules: ['todo'] } });
    await flush();
    expect(screen.getByText('Nothing on the timeline yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a task' })).toBeNull();
  });

  it('says when the day starts, when it is over, and where bedtime falls', async () => {
    vi.setSystemTime(new Date(2026, 2, 10, 7, 0));
    const withBedtime = writeDayProgressSettings(defaultSettings(), {
      ...defaultDayProgressSettings(),
      bedtimeMinutes: 23 * 60,
    });
    const view = renderPanel(withBedtime);
    await flush();
    expect(screen.getByText('Starts at 9:00 AM')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Share of the working day that has passed' }),
    ).toHaveAttribute('aria-valuenow', '0');
    // Bedtime is an item, so the timeline shows it rather than the empty state.
    expect(rows().map((row) => row.getAttribute('data-kind'))).toEqual(['now', 'gap', 'item']);
    expect(rows()[1]).toHaveTextContent('Long stretch — 9 h free');
    expect(rows()[2]).toHaveTextContent('11:00 PM');
    expect(rows()[2]).toHaveTextContent('Bedtime');
    expect(screen.getAllByText('11:00 PM')).toHaveLength(2);
    view.unmount();

    vi.setSystemTime(new Date(2026, 2, 10, 19, 0));
    renderPanel();
    await flush();
    expect(screen.getByText('Over for today')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Share of the working day that has passed' }),
    ).toHaveAttribute('aria-valuenow', '100');
  });
});
