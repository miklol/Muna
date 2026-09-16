import type { AppInfo, MonitorInfo, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings } from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../app-providers';
import { queryClient } from '../lib/query-client';
import type { ModuleDefinition } from '../modules/registry';
import { SettingsApp } from './settings-app';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ok = <T,>(data: T): Promise<IpcResult<T>> => Promise.resolve({ status: 'ok', data });

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ settings: Settings }>[] = [];
  return {
    commands: {
      getSettings: vi.fn<() => Promise<Settings>>(),
      updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
      listMonitors: vi.fn<() => Promise<IpcResult<MonitorInfo[]>>>(),
      appInfo: vi.fn<() => Promise<AppInfo>>(),
      exportSettings: vi.fn<() => Promise<IpcResult<string | null>>>(),
      importSettings: vi.fn<() => Promise<IpcResult<Settings | null>>>(),
      openLogsFolder: vi.fn<() => Promise<IpcResult<null>>>(),
    },
    settingsChanged: {
      listen: vi.fn((callback: Listener<{ settings: Settings }>) => {
        listeners.push(callback);
        return Promise.resolve(() => {
          listeners.splice(listeners.indexOf(callback), 1);
        });
      }),
      emit: (settings: Settings) => {
        for (const listener of [...listeners]) {
          listener({ payload: { settings } });
        }
      },
    },
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: ipc.commands,
  events: { settingsChanged: { listen: ipc.settingsChanged.listen } },
}));

const info: AppInfo = {
  name: 'muna',
  version: '0.3.0',
  platform: 'fake',
  profileDir: 'C:\\Users\\me\\AppData\\Local\\Muna',
};

const monitors: MonitorInfo[] = [
  {
    id: '\\\\.\\DISPLAY1',
    bounds: { x: 0, y: 0, width: 2560, height: 1440 },
    workArea: { x: 0, y: 0, width: 2560, height: 1392 },
    dpi: 144,
    isPrimary: true,
  },
  {
    id: '\\\\.\\DISPLAY2',
    bounds: { x: 2560, y: 0, width: 1920, height: 1080 },
    workArea: { x: 2560, y: 0, width: 1920, height: 1032 },
    dpi: 96,
    isPrimary: false,
  },
];

/** Fake modules: real keys from the catalog stand in for titles. */
const fakeModule = (id: string, titleKey: ModuleDefinition['titleKey']): ModuleDefinition => ({
  id,
  titleKey,
  icon: () => <svg data-testid={`icon-${id}`} />,
  panel: () => <p>{`${id} body`}</p>,
});
const fakeModules: readonly ModuleDefinition[] = [
  fakeModule('strip', 'notch.strip'),
  fakeModule('spike', 'spike.label'),
];

const renderSettings = async (modules?: readonly ModuleDefinition[]) => {
  render(
    <AppProviders>
      <SettingsApp {...(modules === undefined ? {} : { modules })} />
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1, name: 'General' });
};

const nav = () => screen.getByRole('tablist', { name: 'Settings sections' });
const navTitles = () =>
  within(nav())
    .getAllByRole('tab')
    .map((tab) => tab.textContent);
const openPane = (name: string) => {
  fireEvent.click(within(nav()).getByRole('tab', { name }));
};
const lastSaved = (): Settings => {
  const call = ipc.commands.updateSettings.mock.lastCall;
  if (call === undefined) {
    throw new Error('update_settings was not called');
  }
  return call[0];
};

describe('SettingsApp', () => {
  beforeEach(() => {
    queryClient.clear();
    ipc.commands.getSettings.mockReset().mockResolvedValue(defaultSettings());
    ipc.commands.updateSettings.mockReset().mockImplementation((settings) => ok(settings));
    ipc.commands.listMonitors.mockReset().mockImplementation(() => ok(monitors));
    ipc.commands.appInfo.mockReset().mockResolvedValue(info);
    ipc.commands.exportSettings.mockReset().mockImplementation(() => ok('D:\\muna.json'));
    ipc.commands.importSettings.mockReset().mockImplementation(() => ok(null));
    ipc.commands.openLogsFolder.mockReset().mockImplementation(() => ok(null));
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.accent;
  });

  it('lists the built-in panes and opens General first', async () => {
    await renderSettings();
    expect(navTitles()).toEqual([
      'General',
      'Layout',
      'Notch position',
      'Multiple screens',
      'Appearance',
      'Modules',
      'About and diagnostics',
    ]);
    expect(screen.getByRole('switch', { name: 'Launch at login' })).not.toBeChecked();
    expect(ipc.commands.getSettings).toHaveBeenCalledTimes(1);
  });

  it('applies a toggle at once and saves it through update_settings', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('switch', { name: 'Launch at login' }));
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Launch at login' })).toBeChecked();
    });
    expect(ipc.commands.updateSettings).toHaveBeenCalledTimes(1);
    expect(lastSaved().general.launchAtLogin).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a refused save and goes back to what Rust holds', async () => {
    await renderSettings();
    ipc.commands.updateSettings.mockImplementation(() =>
      Promise.resolve({ status: 'error', error: { code: 'settings.io', message: 'disk full' } }),
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Hide from screen captures' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Changes could not be saved. Muna is still using the previous values.',
    );
    await waitFor(() => {
      expect(ipc.commands.getSettings).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Hide from screen captures' })).not.toBeChecked();
    });
  });

  it('mirrors a SettingsChanged event from Rust into the window', async () => {
    await renderSettings();
    const base = defaultSettings();
    act(() => {
      ipc.settingsChanged.emit({ ...base, general: { ...base.general, launchAtLogin: true } });
    });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Launch at login' })).toBeChecked();
    });
    expect(ipc.commands.updateSettings).not.toHaveBeenCalled();
  });

  it('search narrows the sidebar to matching panes and the pane to matching rows', async () => {
    await renderSettings();
    const search = screen.getByRole('searchbox', { name: 'Search settings' });

    fireEvent.change(search, { target: { value: 'screenshot' } });
    expect(navTitles()).toEqual(['General']);
    expect(screen.getByRole('switch', { name: 'Hide from screen captures' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Launch at login' })).toBeNull();

    // A word from another pane switches to it, since General no longer matches.
    fireEvent.change(search, { target: { value: 'colour' } });
    expect(navTitles()).toEqual(['Appearance']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Appearance');
    expect(screen.getByRole('radiogroup', { name: 'Accent colour' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Reduce motion' })).toBeNull();

    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(screen.getByText('No settings match “zzzz”')).toBeInTheDocument();
    expect(within(nav()).queryAllByRole('tab')).toHaveLength(0);

    fireEvent.change(search, { target: { value: '' } });
    expect(navTitles()).toHaveLength(7);
  });

  it('changes the default shape and placement from Layout', async () => {
    await renderSettings();
    openPane('Layout');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Layout');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Shape' })).getByText('Island'));
    await waitFor(() => {
      expect(lastSaved().shell.defaults.shape).toBe('island');
    });
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Placement' })).getByText('Reserved'),
    );
    await waitFor(() => {
      expect(lastSaved().shell.defaults.mode).toBe('reserved');
    });
    expect(lastSaved().shell.defaults.shape).toBe('island');
  });

  it('lists every screen and gives one its own layout when the defaults are switched off', async () => {
    await renderSettings();
    openPane('Multiple screens');
    const first = await screen.findByTestId('screen-\\\\.\\DISPLAY1');
    const second = screen.getByTestId('screen-\\\\.\\DISPLAY2');
    expect(within(first).getByText('Display 1')).toBeInTheDocument();
    expect(within(first).getByText('Primary')).toBeInTheDocument();
    expect(within(first).getByText('2560 × 1440 at 150%')).toBeInTheDocument();
    expect(within(second).queryByText('Primary')).toBeNull();
    expect(within(second).queryByRole('radiogroup', { name: 'Shape' })).toBeNull();

    fireEvent.click(within(second).getByRole('switch', { name: 'Use the defaults' }));
    expect(await within(second).findByRole('radiogroup', { name: 'Shape' })).toBeInTheDocument();
    await waitFor(() => {
      expect(lastSaved().shell.monitors['\\\\.\\DISPLAY2']).toEqual(
        defaultSettings().shell.defaults,
      );
    });

    fireEvent.click(within(second).getByRole('switch', { name: 'Show the notch on this screen' }));
    await waitFor(() => {
      expect(lastSaved().shell.monitors['\\\\.\\DISPLAY2']?.enabled).toBe(false);
    });

    fireEvent.click(within(second).getByRole('switch', { name: 'Use the defaults' }));
    await waitFor(() => {
      expect(lastSaved().shell.monitors).toEqual({});
    });
  });

  it('reorders and hides modules from the registry', async () => {
    await renderSettings(fakeModules);
    openPane('Modules');
    const rows = () =>
      screen.getAllByRole('switch').map((toggle) => toggle.getAttribute('aria-label'));
    expect(rows()).toEqual(['Show Notch strip', 'Show Muna window spike']);
    expect(screen.getByRole('button', { name: 'Move Notch strip up' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move Notch strip down' }));
    await waitFor(() => {
      expect(rows()).toEqual(['Show Muna window spike', 'Show Notch strip']);
    });
    expect(lastSaved().shell.moduleOrder).toEqual(['spike', 'strip']);

    fireEvent.click(screen.getByRole('switch', { name: 'Show Notch strip' }));
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Show Notch strip' })).not.toBeChecked();
    });
    expect(lastSaved().shell.disabledModules).toEqual(['strip']);
  });

  it('shows an empty state when no module is registered', async () => {
    await renderSettings([]);
    openPane('Modules');
    expect(screen.getByText('No modules yet')).toBeInTheDocument();
  });

  it('sets the accent on the document as soon as a swatch is chosen', async () => {
    await renderSettings();
    openPane('Appearance');
    fireEvent.click(screen.getByRole('radio', { name: 'Purple' }));
    await waitFor(() => {
      expect(document.documentElement.dataset.accent).toBe('purple');
    });
    expect(lastSaved().general.accent).toBe('purple');

    fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }));
    await waitFor(() => {
      expect(lastSaved().general.reducedMotion).toBe('on');
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }));
    await waitFor(() => {
      expect(lastSaved().general.reducedMotion).toBe('system');
    });
  });

  it('About shows the build, exports through Rust and resets after a confirmation', async () => {
    await renderSettings();
    openPane('About and diagnostics');
    await waitFor(() => {
      expect(screen.getByTestId('version')).toHaveTextContent('0.3.0');
    });
    expect(screen.getByText('fake')).toBeInTheDocument();
    // Nothing has changed yet, so there is nothing to reset.
    expect(screen.getByRole('button', { name: 'Reset all settings' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Export settings' }));
    expect(await screen.findByText('Saved to D:\\muna.json')).toHaveAttribute('role', 'status');

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(ipc.commands.openLogsFolder).toHaveBeenCalledTimes(1);
    });

    const base = defaultSettings();
    act(() => {
      ipc.settingsChanged.emit({ ...base, general: { ...base.general, accent: 'green' } });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset all settings' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset all settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ipc.commands.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset all settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => {
      expect(lastSaved()).toEqual(defaultSettings());
    });
  });

  it('shows an inline error state with a retry when the document cannot be read', async () => {
    ipc.commands.getSettings.mockRejectedValueOnce(new Error('ipc down'));
    render(
      <AppProviders>
        <SettingsApp />
      </AppProviders>,
    );
    expect(
      await screen.findByText('Settings could not be loaded. Restart Muna and try again.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { level: 1, name: 'General' });
  });
});
