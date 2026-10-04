import type { IpcError, ScreenTimeCommand, ScreenTimeSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { HOUR_MS, MINUTE_MS } from './format';
import { ScreenTimePanel } from './panel';
import { emptySnapshot, sampleSnapshot } from './sample-snapshot';
import { useScreenTimeStore } from './screen-time-store';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ok = <T,>(data: T): IpcResult<T> => ({ status: 'ok', data });

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: ScreenTimeSnapshot }>[] = [];
  return {
    getScreenTimeSnapshot: vi.fn<() => Promise<IpcResult<ScreenTimeSnapshot>>>(),
    screenTimeWatch: vi.fn<(watching: boolean) => Promise<void>>(),
    screenTimeCommand:
      vi.fn<(command: ScreenTimeCommand) => Promise<IpcResult<ScreenTimeSnapshot>>>(),
    openSettings: vi.fn<() => Promise<void>>(),
    listen: vi.fn((callback: Listener<{ snapshot: ScreenTimeSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: ScreenTimeSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getScreenTimeSnapshot: ipc.getScreenTimeSnapshot,
    screenTimeWatch: ipc.screenTimeWatch,
    screenTimeCommand: ipc.screenTimeCommand,
    openSettings: ipc.openSettings,
  },
  events: {
    screenTimeChanged: { listen: ipc.listen },
  },
}));

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <ScreenTimePanel />
    </I18nextProvider>,
  );

const flush = (ms = 50) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('ScreenTimePanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useScreenTimeStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.getScreenTimeSnapshot.mockReset().mockResolvedValue(ok(sampleSnapshot()));
    ipc.screenTimeWatch.mockReset().mockResolvedValue(undefined);
    ipc.screenTimeCommand.mockReset().mockImplementation((command) => {
      const base = sampleSnapshot();
      switch (command.kind) {
        case 'exclude':
          return Promise.resolve(
            ok(
              sampleSnapshot({
                apps: base.apps.filter((app) => app.exe !== command.exe),
                excluded: [...base.excluded, { exe: command.exe, name: command.exe }],
              }),
            ),
          );
        case 'setCategory':
          return Promise.resolve(
            ok(
              sampleSnapshot({
                apps: base.apps.map((app) =>
                  app.exe === command.exe ? { ...app, category: command.category ?? 'other' } : app,
                ),
              }),
            ),
          );
        case 'setLimit':
          return Promise.resolve(
            ok(
              sampleSnapshot({
                apps: base.apps.map((app) =>
                  app.exe === command.exe
                    ? { ...app, limitMinutes: command.minutes, limitReached: false }
                    : app,
                ),
              }),
            ),
          );
        default:
          return Promise.resolve(ok(base));
      }
    });
    ipc.openSettings.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('watches on mount, paints the first snapshot, follows changes and unwatches on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.screenTimeWatch).toHaveBeenCalledWith(true);
    expect(ipc.getScreenTimeSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);
    expect(screen.getByText('3 h 46 min today')).toBeInTheDocument();
    expect(screen.getByText('41 switches')).toBeInTheDocument();

    act(() => {
      ipc.emit(
        sampleSnapshot({
          today: { totalMs: 4 * HOUR_MS, switches: 42, longestMs: HOUR_MS, averageMs: MINUTE_MS },
        }),
      );
    });
    expect(screen.getByText('4 h today')).toBeInTheDocument();
    expect(screen.getByText('42 switches')).toBeInTheDocument();

    view.unmount();
    expect(ipc.screenTimeWatch).toHaveBeenLastCalledWith(false);
    expect(ipc.listenerCount()).toBe(0);
  });

  it('shows the app in front, the donut with its legend, the facts and the ranking', async () => {
    renderPanel();
    await flush();
    const now = screen.getByRole('region', { name: 'Now' });
    expect(within(now).getByText('Visual Studio Code')).toBeInTheDocument();
    expect(within(now).getByText(/Development · since/)).toBeInTheDocument();

    const donut = screen.getByRole('img', { name: '3 h 46 min today across 5 categories' });
    expect(donut.querySelectorAll('.muna-segmented-ring__segment')).toHaveLength(5);
    const legend = screen.getByRole('list', { name: 'Categories' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'Browsing58 min',
      'Development2 h 5 min',
      'Communication27 min',
      'Games32 min',
      'System4 min',
    ]);
    expect(screen.getByText('Average session').nextElementSibling).toHaveTextContent('5 min');
    expect(screen.getByText('Longest session').nextElementSibling).toHaveTextContent('41 min');

    const ranking = screen.getByRole('list', { name: 'Apps' });
    const rows = within(ranking).getAllByRole('button');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Visual Studio Code, 2 h 5 min',
      'Microsoft Edge, 58 min',
      'Microsoft Teams, 27 min',
      'Steam, 32 min of a 30 min limit',
      'Windows Explorer, 4 min',
    ]);
    // The game passed its limit: its row says so and its bar turns orange.
    const steam = rows[3]?.closest('li');
    expect(steam).toHaveAttribute('data-limit-reached');
    expect(steam?.querySelector('.muna-progress-track')?.getAttribute('style') ?? '').toContain(
      '--accent-orange',
    );
  });

  it('says why nothing is counted: away, locked, off, or nothing yet', async () => {
    ipc.getScreenTimeSnapshot.mockResolvedValue(
      ok(sampleSnapshot({ now: null, tracking: 'idle' })),
    );
    renderPanel();
    await flush();
    expect(screen.getByText('Away')).toBeInTheDocument();
    expect(screen.getByText('Time stops counting until you are back.')).toBeInTheDocument();

    act(() => {
      ipc.emit(sampleSnapshot({ now: null, tracking: 'locked' }));
    });
    expect(screen.getByText('Locked')).toBeInTheDocument();

    act(() => {
      ipc.emit(emptySnapshot({ tracking: 'off' }));
    });
    expect(screen.getByText('Screen time is off')).toBeInTheDocument();
    expect(screen.getByText('Turn it on in Settings to start counting.')).toBeInTheDocument();
    expect(screen.getByText('No apps yet today')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Categories' })).not.toBeInTheDocument();

    act(() => {
      ipc.emit(emptySnapshot());
    });
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.getByText('0 min today')).toBeInTheDocument();
  });

  it('switches to the week: seven labelled days, today last, and the daily average', async () => {
    renderPanel();
    await flush();
    const week = screen.getByRole('button', { name: 'Week' });
    expect(week).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(week);
    expect(week).toHaveAttribute('aria-pressed', 'true');
    const region = screen.getByRole('region', { name: 'Last 7 days' });
    const days = within(region).getAllByRole('listitem');
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAttribute('aria-label', 'Wed, 5 h 40 min');
    expect(days[3]).toHaveAttribute('aria-label', 'Sat, 0 min');
    expect(days[6]).toHaveAttribute('aria-label', 'Today, 3 h 46 min');
    expect(days[6]).toHaveAttribute('data-today');
    // The busiest day fills the column; an empty one keeps only its baseline.
    expect(days[4]?.querySelector('.stime-week__bar')).toHaveStyle({ blockSize: '100%' });
    expect(days[3]?.querySelector('.stime-week__bar')).toHaveStyle({ blockSize: '0%' });
    expect(within(region).getByText(/Daily average 4 h 58 min/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Now' })).not.toBeInTheDocument();

    fireEvent.click(week);
    expect(screen.getByRole('region', { name: 'Now' })).toBeInTheDocument();
  });

  it('opens an app’s details, changes its category and its limit, and comes back', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Steam, 32 min of a 30 min limit' }));
    const detail = screen.getByRole('region', { name: 'Steam' });
    expect(within(detail).getByRole('heading', { name: 'Steam' })).toBeInTheDocument();
    expect(within(detail).getByText('32 min · 1 session · Longest 32 min')).toBeInTheDocument();
    expect(within(detail).getByText('Limit reached')).toBeInTheDocument();

    const category = within(detail).getByRole('group', { name: 'Category' });
    expect(within(category).getByRole('button', { name: 'Games' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(category).getByRole('button', { name: 'Media' }));
    await flush();
    expect(ipc.screenTimeCommand).toHaveBeenCalledWith({
      kind: 'setCategory',
      exe: 'steam.exe',
      category: 'media',
    });
    expect(within(category).getByRole('button', { name: 'Media' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const limit = within(detail).getByRole('group', { name: 'Daily limit' });
    expect(within(limit).getByRole('button', { name: '30 min' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(limit).getByRole('button', { name: '2 h' }));
    await flush();
    expect(ipc.screenTimeCommand).toHaveBeenCalledWith({
      kind: 'setLimit',
      exe: 'steam.exe',
      minutes: 120,
    });
    expect(
      within(detail).getByText('The notch nudges you once when the app passes this today.'),
    ).toBeInTheDocument();
    fireEvent.click(within(limit).getByRole('button', { name: 'None' }));
    await flush();
    expect(ipc.screenTimeCommand).toHaveBeenLastCalledWith({
      kind: 'setLimit',
      exe: 'steam.exe',
      minutes: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back to today' }));
    expect(screen.getByRole('region', { name: 'Now' })).toBeInTheDocument();
  });

  it('excludes an app from its details and returns to a ranking without it', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Microsoft Teams, 27 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exclude this app' }));
    await flush();
    expect(ipc.screenTimeCommand).toHaveBeenCalledWith({ kind: 'exclude', exe: 'ms-teams.exe' });
    const ranking = screen.getByRole('list', { name: 'Apps' });
    expect(within(ranking).queryByRole('button', { name: /Teams/ })).not.toBeInTheDocument();
    expect(within(ranking).getAllByRole('button')).toHaveLength(4);
  });

  it('falls back when the app it was showing left the ranking', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Windows Explorer, 4 min' }));
    act(() => {
      ipc.emit(emptySnapshot());
    });
    expect(screen.getByText('That app is not in the history any more.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to today' }));
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });

  it('opens Settings from the head', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
  });

  it('renders nothing until the first snapshot arrives', () => {
    ipc.getScreenTimeSnapshot.mockReturnValue(new Promise(() => undefined));
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });
});
