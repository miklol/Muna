import type { CalendarEvent, CalendarSnapshot, SourceView } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useCalendarStore } from './calendar-store';
import { CalendarWidget } from './widget';

const ipc = vi.hoisted(() => ({
  getCalendarSnapshot: vi.fn<() => Promise<CalendarSnapshot>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten from outside Tauri.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { getCalendarSnapshot: ipc.getCalendarSnapshot },
  events: { calendarChanged: { listen: ipc.listen } },
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
  eventCount: 5,
};

let counter = 0;
const event = (overrides: Partial<CalendarEvent>): CalendarEvent => {
  counter += 1;
  return {
    id: `work:e${String(counter)}`,
    sourceId: 'work',
    title: `Event ${String(counter)}`,
    location: null,
    startMs: at(26, 9),
    endMs: at(26, 10),
    allDay: false,
    link: null,
    isMeeting: false,
    ...overrides,
  };
};

const snapshot = (events: CalendarEvent[], sources: SourceView[] = [work]): CalendarSnapshot => ({
  sources,
  events,
  windowStartMs: at(26, 0) - 60 * 86_400_000,
  windowEndMs: at(26, 0) + 60 * 86_400_000,
  offline: false,
});

const renderWidget = (span: 1 | 2) =>
  render(
    <I18nextProvider i18n={i18n}>
      <CalendarWidget span={span} />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('CalendarWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useCalendarStore.setState({ snapshot: null });
    ipc.getCalendarSnapshot.mockReset();
    ipc.listen.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('lists the next three events that have not ended, with the day when it is not today', async () => {
    ipc.getCalendarSnapshot.mockResolvedValue(
      snapshot([
        event({ title: 'Over', startMs: at(26, 7), endMs: at(26, 8) }),
        event({ title: 'Stand-up', startMs: at(26, 8, 45), endMs: at(26, 9, 15) }),
        event({ title: 'Hack day', startMs: at(26, 0), endMs: at(27, 0), allDay: true }),
        event({
          title: 'Design review',
          location: 'Room 4',
          startMs: at(26, 11),
          endMs: at(26, 12),
        }),
        event({ title: 'Retro', startMs: at(28, 10), endMs: at(28, 11) }),
      ]),
    );
    const view = renderWidget(1);
    await flush();
    const list = screen.getByRole('list', { name: 'Next events' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('8:45 AM');
    expect(rows[0]).toHaveTextContent('Stand-up');
    expect(rows[1]).toHaveTextContent('All day');
    expect(rows[1]).toHaveTextContent('Hack day');
    expect(rows[2]).toHaveTextContent('11:00 AM');
    expect(rows[2]).toHaveTextContent('Design review');
    // A single column has no room for the place.
    expect(list).not.toHaveTextContent('Room 4');
    expect(screen.queryByText('Retro')).not.toBeInTheDocument();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('names the day for later events and adds the place on a wide card', async () => {
    ipc.getCalendarSnapshot.mockResolvedValue(
      snapshot([
        event({
          title: 'Design review',
          location: 'Room 4',
          startMs: at(26, 11),
          endMs: at(26, 12),
        }),
        event({ title: 'Retro', startMs: at(28, 10), endMs: at(28, 11) }),
        event({ title: 'Offsite', startMs: at(29, 0), endMs: at(30, 0), allDay: true }),
      ]),
    );
    renderWidget(2);
    await flush();
    const rows = within(screen.getByRole('list', { name: 'Next events' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Room 4');
    expect(rows[1]).toHaveTextContent('Mon, Sep 28');
    expect(rows[2]).toHaveTextContent('Tue, Sep 29');
    expect(rows[2]).not.toHaveTextContent('All day');
  });

  it('says so in one line with no calendar or nothing ahead', async () => {
    ipc.getCalendarSnapshot.mockResolvedValue(snapshot([], []));
    const view = renderWidget(1);
    await flush();
    expect(screen.getByText('No calendars yet')).toBeInTheDocument();
    view.unmount();

    ipc.getCalendarSnapshot.mockResolvedValue(
      snapshot([event({ startMs: at(26, 7), endMs: at(26, 8) })]),
    );
    renderWidget(1);
    await flush();
    expect(screen.getByText('Nothing ahead')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
