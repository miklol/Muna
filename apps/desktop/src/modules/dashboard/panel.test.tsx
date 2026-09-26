import type { Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  DEFAULT_DASHBOARD_SLOTS,
  defaultSettings,
  readDashboardSettings,
  writeDashboardSettings,
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
import type * as Registry from '../registry';
import type { ModuleDefinition, WidgetProps } from '../registry';
import { DashboardPanel } from './panel';

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<{ status: 'ok'; data: null }>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { updateSettings: ipc.updateSettings },
}));

/**
 * The registry is replaced by fakes so the grid is tested on its own: every P1 module gets a
 * widget that prints its id and span, the HUD has none, and a stray module has no widget either.
 */
vi.mock('../registry', async (importOriginal) => {
  const actual = await importOriginal<typeof Registry>();
  const widgetIds = [
    'media',
    'pomodoro',
    'todo',
    'weather',
    'day-progress',
    'system-monitor',
    'bluetooth',
  ];
  const titles: Record<string, ModuleDefinition['titleKey']> = {
    dashboard: 'dashboard.title',
    media: 'media.title',
    pomodoro: 'pomodoro.title',
    todo: 'todo.title',
    weather: 'weather.title',
    'day-progress': 'dayProgress.title',
    'system-monitor': 'systemMonitor.title',
    bluetooth: 'bluetooth.title',
    hud: 'hud.title',
  };
  const fake = (id: string): ModuleDefinition => ({
    id,
    titleKey: titles[id] ?? 'app.name',
    icon: () => null,
    panel: () => null,
    ...(widgetIds.includes(id)
      ? {
          widget: ({ span }: WidgetProps) => (
            <span data-testid={`widget-${id}`}>{`${id} × ${span}`}</span>
          ),
        }
      : {}),
  });
  const modules = ['dashboard', ...widgetIds, 'hud'].map(fake);
  return {
    ...actual,
    modules,
    findModule: (id: string) => modules.find((module) => module.id === id),
  };
});

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
      <DashboardPanel />
    </Providers>,
  );
};

const grid = () => screen.getByRole('list', { name: 'Widgets' });
const cards = () =>
  within(grid())
    .getAllByRole('listitem')
    .filter((item) => item.hasAttribute('data-module'));
const cardIds = () => cards().map((card) => card.getAttribute('data-module'));
const press = (name: string | RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

/** The layout the last save carried. */
const savedSlots = () => {
  const calls = ipc.updateSettings.mock.calls;
  const last = calls[calls.length - 1]?.[0];
  return last === undefined ? undefined : readDashboardSettings(last).slots;
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });

describe('DashboardPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    useAppStore.setState({ activeModuleId: null });
    ipc.updateSettings.mockReset().mockResolvedValue({ status: 'ok', data: null });
  });

  afterEach(async () => {
    cleanup();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  it('renders the default layout: seven cards, media two columns wide, each with its widget', () => {
    renderPanel();
    expect(cardIds()).toEqual(DEFAULT_DASHBOARD_SLOTS.map((slot) => slot.moduleId));
    expect(cards()[0]).toHaveAttribute('data-span', '2');
    expect(screen.getByTestId('widget-media')).toHaveTextContent('media × 2');
    expect(screen.getByTestId('widget-weather')).toHaveTextContent('weather × 1');
    expect(screen.getByText('7 widgets')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Media' })).toBeInTheDocument();
    // Nothing is arranged until the pencil is pressed.
    expect(screen.queryByRole('button', { name: /Move .* left/ })).not.toBeInTheDocument();
  });

  it('leaves out disabled modules and ones without a widget, and offers them back when re-enabled', () => {
    const settings = writeDashboardSettings(
      { ...defaultSettings(), shell: { ...defaultSettings().shell, disabledModules: ['weather'] } },
      { slots: [...DEFAULT_DASHBOARD_SLOTS, { moduleId: 'hud', span: 1 }] },
    );
    renderPanel(settings);
    expect(cardIds()).toEqual([
      'media',
      'pomodoro',
      'todo',
      'day-progress',
      'system-monitor',
      'bluetooth',
    ]);
    expect(screen.getByText('6 widgets')).toBeInTheDocument();
  });

  it('opens a module from its card', () => {
    renderPanel();
    press('Open Weather');
    expect(useAppStore.getState().activeModuleId).toBe('weather');
  });

  it('moves, resizes and removes cards in edit mode, saving the layout each time', async () => {
    renderPanel();
    press('Edit layout');
    expect(screen.getByRole('button', { name: 'Done editing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Widgets give way to the controls while editing.
    expect(screen.queryByTestId('widget-media')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Media left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Bluetooth right' })).toBeDisabled();
    // The grid is full, so nothing can get wider; media can get narrower.
    expect(screen.getByRole('button', { name: 'Make Pomodoro wider' })).toBeDisabled();

    press('Move Pomodoro right');
    await flush();
    expect(cardIds()).toEqual([
      'media',
      'todo',
      'pomodoro',
      'weather',
      'day-progress',
      'system-monitor',
      'bluetooth',
    ]);
    expect(ipc.updateSettings).toHaveBeenCalledTimes(1);
    expect(savedSlots()?.map((slot) => slot.moduleId)).toEqual(cardIds());

    press('Make Media narrower');
    await flush();
    expect(cards()[0]).toHaveAttribute('data-span', '1');
    // One cell is free now: widening fits again.
    expect(screen.getByRole('button', { name: 'Make Pomodoro wider' })).toBeEnabled();
    press('Make Pomodoro wider');
    await flush();
    expect(savedSlots()).toEqual([
      { moduleId: 'media', span: 1 },
      { moduleId: 'todo', span: 1 },
      { moduleId: 'pomodoro', span: 2 },
      { moduleId: 'weather', span: 1 },
      { moduleId: 'day-progress', span: 1 },
      { moduleId: 'system-monitor', span: 1 },
      { moduleId: 'bluetooth', span: 1 },
    ]);

    press('Remove Weather');
    await flush();
    expect(cardIds()).not.toContain('weather');
    expect(savedSlots()?.some((slot) => slot.moduleId === 'weather')).toBe(false);

    // The free cell offers the removed widget back.
    press('Add Weather');
    await flush();
    expect(cardIds()).toEqual([
      'media',
      'todo',
      'pomodoro',
      'day-progress',
      'system-monitor',
      'bluetooth',
      'weather',
    ]);
    expect(screen.queryByRole('button', { name: 'Add Weather' })).not.toBeInTheDocument();

    press('Done editing');
    expect(screen.getByTestId('widget-media')).toBeInTheDocument();
    expect(ipc.updateSettings).toHaveBeenCalledTimes(5);
  });

  it('keeps a disabled module\u2019s slot in the document across edits', async () => {
    const base = defaultSettings();
    renderPanel({ ...base, shell: { ...base.shell, disabledModules: ['weather'] } });
    press('Edit layout');
    press('Remove Bluetooth');
    await flush();
    expect(savedSlots()?.map((slot) => slot.moduleId)).toEqual([
      'media',
      'pomodoro',
      'todo',
      'day-progress',
      'system-monitor',
      'weather',
    ]);
  });

  it('says what to do when the grid is empty and leads into edit mode', async () => {
    renderPanel(writeDashboardSettings(defaultSettings(), { slots: [] }));
    expect(screen.getByText('No widgets on the grid')).toBeInTheDocument();
    press('Edit layout');
    await flush();
    expect(screen.getByRole('group', { name: 'Add a widget' })).toBeInTheDocument();
    press('Add Tasks');
    await flush();
    expect(cardIds()).toEqual(['todo']);
    expect(savedSlots()).toEqual([{ moduleId: 'todo', span: 1 }]);
  });

  it('drops a refused save and re-reads the document', async () => {
    ipc.updateSettings.mockRejectedValue(new Error('nope'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderPanel();
    press('Edit layout');
    press('Remove Weather');
    await flush();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsQueryKey });
    invalidate.mockRestore();
  });
});
