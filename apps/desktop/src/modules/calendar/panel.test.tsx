import type {
  CalendarCommand,
  CalendarEvent,
  CalendarSnapshot,
  IpcError,
  SourceView,
} from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useCalendarStore } from './calendar-store';
import { CalendarPanel } from './panel';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: CalendarSnapshot }>[] = [];
  return {
    getCalendarSnapshot: vi.fn<() => Promise<CalendarSnapshot>>(),
    calendarCommand: vi.fn<(command: CalendarCommand) => Promise<CalendarSnapshot>>(),
    calendarOpen: vi.fn<(eventId: string) => Promise<IpcResult<null>>>(),
    openSettings: vi.fn<() => Promise<void>>(),
    listen: vi.fn((callback: Listener<{ snapshot: CalendarSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: CalendarSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getCalendarSnapshot: ipc.getCalendarSnapshot,
    calendarCommand: ipc.calendarCommand,
    calendarOpen: ipc.calendarOpen,
    openSettings: ipc.openSettings,
  },
  events: {
    calendarChanged: { listen: ipc.listen },
  },
}));

/** Saturday 26 September 2026, 09:00 local. */
const NOW = new Date(2026, 8, 26, 9, 0);
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 8, day, hour, minute).getTime();

const work: SourceView = {
  id: 'work',
  name: 'Work',
  color: 'purple',
  enabled: true,
  host: 'calendar.example.com',
  status: { kind: 'ok' },
  fetchedAtMs: at(26, 8, 55),
  eventCount: 3,
};

const standup: CalendarEvent = {
  id: 'work:standup',
  sourceId: 'work',
  title: 'Stand-up',
  location: null,
  startMs: at(26, 8, 45),
  endMs: at(26, 9, 15),
  allDay: false,
  link: 'https://meet.example.com/standup',
  isMeeting: true,
};
const review: CalendarEvent = {
  id: 'work:review',
  sourceId: 'work',
  title: 'Design review',
  location: 'Room 4',
  startMs: at(26, 11, 0),
  endMs: at(26, 12, 0),
  allDay: false,
  link: 'https://calendar.example.com/review',
  isMeeting: false,
};
const offsite: CalendarEvent = {
  id: 'work:offsite',
  sourceId: 'work',
  title: '',
  location: null,
  startMs: at(28, 0),
  endMs: at(29, 0),
  allDay: true,
  link: null,
  isMeeting: false,
};

const snapshot = (overrides: Partial<CalendarSnapshot> = {}): CalendarSnapshot => ({
  sources: [work],
  events: [standup, review, offsite],
  windowStartMs: at(26, 0) - 60 * 86_400_000,
  windowEndMs: at(26, 0) + 60 * 86_400_000,
  offline: false,
  ...overrides,
});

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <CalendarPanel />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const agenda = () => screen.getByRole('region', { name: 'Agenda' });

describe('CalendarPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useCalendarStore.setState({ snapshot: null });
    ipc.getCalendarSnapshot.mockReset().mockResolvedValue(snapshot());
    ipc.calendarCommand.mockReset();
    ipc.calendarOpen.mockReset().mockResolvedValue({ status: 'ok', data: null });
    ipc.openSettings.mockReset().mockResolvedValue(undefined);
    ipc.listen.mockClear();
  });

  afterEach(async () => {
    cleanup();
    // Let Motion's frame loop run the frame it scheduled before the timers go real.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  it("subscribes on mount, shows today's agenda beside the month, and unlistens on unmount", async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.getCalendarSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);

    const grid = screen.getByRole('application', { name: /^Month, / });
    expect(
      within(grid).getByRole('heading', { name: 'Month, September 2026' }),
    ).toBeInTheDocument();
    const today = within(grid).getByRole('button', { name: /Saturday, September 26, 2026/ });
    expect(today).toHaveAttribute('data-today');
    expect(today).toHaveAttribute('data-selected');

    expect(
      within(agenda()).getByRole('heading', { name: 'Saturday, September 26' }),
    ).toBeInTheDocument();
    expect(agenda()).toHaveTextContent('2 events');
    const rows = within(agenda()).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Stand-up');
    expect(rows[0]).toHaveTextContent(/8:45\s?–\s?9:15\s?AM/);
    // The call is on right now, so its meeting link is the primary action.
    expect(rows[0]).toHaveAttribute('data-now');
    expect(within(agenda()).getByRole('button', { name: 'Join Stand-up' })).toHaveClass(
      'muna-button--primary',
    );
    expect(rows[1]).toHaveTextContent('Design review');
    expect(rows[1]).toHaveTextContent('Room 4');
    expect(within(agenda()).getByRole('button', { name: 'Open Design review' })).toHaveClass(
      'muna-button--secondary',
    );
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();

    view.unmount();
    await flush();
    expect(ipc.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('opens the meeting link through Rust and asks for a refresh', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Join Stand-up' }));
    await flush();
    expect(ipc.calendarOpen).toHaveBeenCalledWith('work:standup');

    ipc.calendarCommand.mockResolvedValue(
      snapshot({ sources: [{ ...work, status: { kind: 'fetching' } }] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();
    expect(ipc.calendarCommand).toHaveBeenCalledWith({ kind: 'refresh' });
    // While a source is on the wire the button waits.
    expect(screen.getByRole('button', { name: 'Refreshing' })).toBeDisabled();
  });

  it('follows the selected day, marks days with events and explains the loaded window', async () => {
    renderPanel();
    await flush();
    const grid = screen.getByRole('application', { name: /^Month, / });

    // The 28th carries the untitled all-day event; the 27th has nothing.
    const monday = within(grid).getByRole('button', { name: /Monday, September 28, 2026/ });
    expect(monday.querySelectorAll('.muna-month-grid__mark')).toHaveLength(1);
    fireEvent.click(monday);
    await flush();
    expect(
      within(agenda()).getByRole('heading', { name: 'Monday, September 28' }),
    ).toBeInTheDocument();
    const rows = within(agenda()).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('All day');
    expect(rows[0]).toHaveTextContent('Untitled event');
    // Without a link there is nothing to open: the refresh button is the agenda's only one.
    expect(within(agenda()).getAllByRole('button')).toHaveLength(1);

    fireEvent.click(within(grid).getByRole('button', { name: /Sunday, September 27, 2026/ }));
    await flush();
    expect(screen.getByText('Nothing on this day.')).toBeInTheDocument();

    // A day past the window says why it is blank rather than pretending it is free.
    ipc.emit(snapshot({ windowEndMs: at(30, 0) }));
    await flush();
    fireEvent.click(within(grid).getByRole('button', { name: /Wednesday, September 30, 2026/ }));
    await flush();
    expect(screen.getByText('Only the sixty days around today are loaded.')).toBeInTheDocument();

    // Today brings the selection back.
    fireEvent.click(within(grid).getByRole('button', { name: 'Today' }));
    await flush();
    expect(
      within(agenda()).getByRole('heading', { name: 'Saturday, September 26' }),
    ).toBeInTheDocument();
  });

  it('keeps the cached events offline and flags a calendar that needs the user', async () => {
    renderPanel();
    await flush();
    ipc.emit(
      snapshot({
        offline: true,
        sources: [
          { ...work, status: { kind: 'error', error: 'offline' } },
          {
            ...work,
            id: 'home',
            name: 'Home',
            color: 'green',
            status: { kind: 'error', error: 'refused' },
          },
        ],
      }),
    );
    await flush();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('Some calendars need attention')).toBeInTheDocument();
    expect(within(agenda()).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says what to do when no calendar is subscribed', async () => {
    ipc.getCalendarSnapshot.mockResolvedValue(snapshot({ sources: [], events: [] }));
    renderPanel();
    await flush();
    expect(screen.getByText('No calendars yet')).toBeInTheDocument();
    expect(screen.queryByRole('application')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    await flush();
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
  });
});
