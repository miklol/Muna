import type {
  CalendarSnapshot,
  IpcError,
  Settings,
  SourceSetting,
  SourceView,
  Tint,
} from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readCalendarSettings, writeCalendarSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { useCalendarStore } from './calendar-store';
import { CalendarSettingsPane, describeSource } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getCalendarSnapshot: vi.fn<() => Promise<CalendarSnapshot>>(),
  calendarAddSource:
    vi.fn<(name: string, url: string, color: Tint) => Promise<IpcResult<SourceSetting>>>(),
  calendarRemoveSource: vi.fn<(id: string) => Promise<IpcResult<Settings>>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten from outside Tauri.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getCalendarSnapshot: ipc.getCalendarSnapshot,
    calendarAddSource: ipc.calendarAddSource,
    calendarRemoveSource: ipc.calendarRemoveSource,
  },
  events: { calendarChanged: { listen: ipc.listen } },
}));

const at = (hour: number, minute = 0): number => new Date(2026, 8, 26, hour, minute).getTime();

const workSetting: SourceSetting = {
  id: 'work',
  name: 'Work',
  color: 'purple',
  enabled: true,
  host: 'calendar.example.com',
};
const workView: SourceView = {
  ...workSetting,
  status: { kind: 'ok' },
  fetchedAtMs: at(8, 55),
  eventCount: 3,
};

const snapshot = (sources: SourceView[]): CalendarSnapshot => ({
  sources,
  events: [],
  windowStartMs: at(0),
  windowEndMs: at(0) + 86_400_000,
  offline: false,
});

const withSources = (sources: SourceSetting[]): Settings =>
  writeCalendarSettings(defaultSettings(), { ...readCalendarSettings(defaultSettings()), sources });

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('describeSource', () => {
  const t = i18n.t.bind(i18n);

  it('joins the host with where the last fetch stands', () => {
    expect(describeSource(workSetting, workView, t, 'en')).toBe(
      'calendar.example.com · Updated 8:55 AM · 3 events',
    );
    expect(describeSource(workSetting, undefined, t, 'en')).toBe(
      'calendar.example.com · Not fetched yet',
    );
    expect(describeSource({ ...workSetting, enabled: false }, workView, t, 'en')).toBe(
      'calendar.example.com · Off',
    );
    expect(
      describeSource(workSetting, { ...workView, status: { kind: 'fetching' } }, t, 'en'),
    ).toBe('calendar.example.com · Refreshing');
    expect(
      describeSource(
        workSetting,
        { ...workView, status: { kind: 'error', error: 'offline' } },
        t,
        'en',
      ),
    ).toBe('calendar.example.com · Offline, showing events from 8:55 AM');
    expect(
      describeSource(
        workSetting,
        { ...workView, fetchedAtMs: null, status: { kind: 'error', error: 'offline' } },
        t,
        'en',
      ),
    ).toBe('calendar.example.com · Offline');
    expect(
      describeSource(
        workSetting,
        { ...workView, status: { kind: 'error', error: 'refused' } },
        t,
        'en',
      ),
    ).toBe(
      'calendar.example.com · The link was refused. It may have expired; add the calendar again.',
    );
  });
});

describe('CalendarSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useCalendarStore.setState({ snapshot: null });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getCalendarSnapshot.mockReset().mockResolvedValue(snapshot([]));
    ipc.calendarAddSource.mockReset();
    ipc.calendarRemoveSource.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderPane = () => {
    const Host = () => {
      const settings = useSettings() ?? defaultSettings();
      return (
        <SettingsEditorProvider settings={settings}>
          <CalendarSettingsPane />
        </SettingsEditorProvider>
      );
    };
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <Host />
        </QueryClientProvider>
      </I18nextProvider>,
    );
  };

  const saved = () =>
    readCalendarSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  const typeInto = (name: string, value: string) => {
    fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
  };

  it('starts with no calendars, a five-minute refresh and both strip options on', async () => {
    renderPane();
    await flush();
    expect(screen.getByText(/Links stay in Windows Credential Manager/)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Show Work' })).not.toBeInTheDocument();
    const refresh = screen.getByRole('radiogroup', { name: 'Refresh every' });
    expect(within(refresh).getByRole('radio', { name: '5 min' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Show the next event in the strip' })).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Announce events ten minutes before' }),
    ).toBeChecked();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('adds a calendar through Rust and shows it without echoing the link', async () => {
    ipc.calendarAddSource.mockResolvedValue({
      status: 'ok',
      data: { ...workSetting, color: 'green' },
    });
    renderPane();
    await flush();
    typeInto('Name', 'Work');
    typeInto('Link', 'webcal://calendar.example.com/feed.ics');
    const colours = screen.getByRole('group', { name: 'Colour' });
    fireEvent.click(within(colours).getByRole('button', { name: 'Green' }));
    expect(within(colours).getByRole('button', { name: 'Green' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await flush();

    expect(ipc.calendarAddSource).toHaveBeenCalledWith(
      'Work',
      'webcal://calendar.example.com/feed.ics',
      'green',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Added Work.');
    expect(screen.getByRole('switch', { name: 'Show Work' })).toBeChecked();
    expect(screen.getByText('calendar.example.com · Not fetched yet')).toBeInTheDocument();
    expect(screen.queryByText(/feed\.ics/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Link' })).toHaveValue('');
    // Rust saved and broadcast the settings itself; the pane only mirrors them.
    expect(ipc.updateSettings).not.toHaveBeenCalled();
  });

  it('explains a refused link in plain words and asks for a name first', async () => {
    ipc.calendarAddSource.mockResolvedValue({
      status: 'error',
      error: { code: 'calendar.url.scheme', message: 'unsupported scheme' },
    });
    renderPane();
    await flush();
    typeInto('Link', 'ftp://calendar.example.com/feed.ics');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Give the calendar a name.');
    expect(ipc.calendarAddSource).not.toHaveBeenCalled();

    typeInto('Name', 'Work');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Only https and webcal links work.');
    expect(screen.getByRole('textbox', { name: 'Link' })).toHaveValue(
      'ftp://calendar.example.com/feed.ics',
    );
  });

  it('turns a calendar off in the settings and removes it through Rust', async () => {
    cacheSettings(queryClient, withSources([workSetting]));
    ipc.getCalendarSnapshot.mockResolvedValue(snapshot([workView]));
    ipc.calendarRemoveSource.mockResolvedValue({ status: 'ok', data: defaultSettings() });
    renderPane();
    await flush();
    expect(
      screen.getByText('calendar.example.com · Updated 8:55 AM · 3 events'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Show Work' }));
    await flush();
    expect(saved().sources).toEqual([{ ...workSetting, enabled: false }]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Work' }));
    await flush();
    expect(ipc.calendarRemoveSource).toHaveBeenCalledWith('work');
    expect(screen.queryByRole('switch', { name: 'Show Work' })).not.toBeInTheDocument();
  });

  it('saves the refresh period and the strip options', async () => {
    renderPane();
    await flush();
    const refresh = screen.getByRole('radiogroup', { name: 'Refresh every' });
    fireEvent.click(within(refresh).getByRole('radio', { name: '30 min' }));
    await flush();
    expect(saved().refreshMinutes).toBe(30);

    fireEvent.click(screen.getByRole('switch', { name: 'Show the next event in the strip' }));
    await flush();
    expect(saved().showNextInStrip).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Announce events ten minutes before' }));
    await flush();
    expect(saved().notices).toBe(false);
  });
});
