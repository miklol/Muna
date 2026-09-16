import type { MonitorInfo, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings } from '@muna/contracts';
import { useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../../app-providers';
import { queryClient } from '../../lib/query-client';
import { settingsQueryOptions } from '../../lib/settings';
import { SettingsEditorProvider } from '../settings-editor';
import { OnboardingFlow, onboardingSteps } from './onboarding-flow';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ok = <T,>(data: T): Promise<IpcResult<T>> => Promise.resolve({ status: 'ok', data });

const ipc = vi.hoisted(() => ({
  commands: {
    getSettings: vi.fn<() => Promise<Settings>>(),
    updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
    listMonitors: vi.fn<() => Promise<IpcResult<MonitorInfo[]>>>(),
  },
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: ipc.commands,
  events: { settingsChanged: { listen: ipc.listen } },
}));

const monitor = (id: string, width: number, isPrimary: boolean): MonitorInfo => ({
  id,
  bounds: { x: 0, y: 0, width, height: 1080 },
  workArea: { x: 0, y: 0, width, height: 1032 },
  dpi: 96,
  isPrimary,
});
const twoMonitors = [
  monitor('\\\\.\\DISPLAY1', 2560, true),
  monitor('\\\\.\\DISPLAY2', 1920, false),
];

/** The tour the way the settings window hosts it: over the live settings document. */
function Host({ onDone }: { onDone: () => void }) {
  const settings = useQuery(settingsQueryOptions);
  if (settings.data === undefined) {
    return null;
  }
  return (
    <SettingsEditorProvider settings={settings.data}>
      <OnboardingFlow onDone={onDone} />
    </SettingsEditorProvider>
  );
}

const renderTour = async (onDone = vi.fn()) => {
  render(
    <AppProviders>
      <Host onDone={onDone} />
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 2, name: 'Welcome to Muna' });
  return onDone;
};

const heading = (name: string) => screen.findByRole('heading', { level: 2, name });
const next = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
};
const lastSaved = (): Settings => {
  const call = ipc.commands.updateSettings.mock.lastCall;
  if (call === undefined) {
    throw new Error('update_settings was not called');
  }
  return call[0];
};

describe('onboardingSteps', () => {
  it('keeps the screens step while the list loads and with two or more screens', () => {
    expect(onboardingSteps({ isError: false, data: undefined })).toHaveLength(7);
    expect(onboardingSteps({ isError: false, data: twoMonitors })).toContain('displays');
  });

  it('leaves the screens step out with one screen or no list', () => {
    const single = onboardingSteps({ isError: false, data: [twoMonitors[0]!] });
    expect(single).toHaveLength(6);
    expect(single).not.toContain('displays');
    expect(onboardingSteps({ isError: true, data: undefined })).not.toContain('displays');
  });
});

describe('OnboardingFlow', () => {
  beforeEach(() => {
    queryClient.clear();
    ipc.commands.getSettings.mockReset().mockResolvedValue(defaultSettings());
    ipc.commands.updateSettings.mockReset().mockImplementation((settings) => ok(settings));
    ipc.commands.listMonitors.mockReset().mockImplementation(() => ok(twoMonitors));
  });

  afterEach(() => {
    cleanup();
  });

  it('walks the steps in order, counts them and moves focus to each new title', async () => {
    await renderTour();
    expect(screen.getByRole('main', { name: 'Welcome tour' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 7')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(document.activeElement).toBe(document.body);

    next();
    const screens = await heading('Choose your screens');
    expect(screen.getByText('Step 2 of 7')).toBeInTheDocument();
    expect(screens).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await heading('Welcome to Muna')).toHaveFocus();
    expect(screen.getByText('Step 1 of 7')).toBeInTheDocument();

    for (const title of [
      'Choose your screens',
      'Choose how it sits',
      'Pick a shape',
      'What Muna will ask for',
      'Start with Windows',
      'All set',
    ]) {
      next();
      await heading(title);
    }
    expect(screen.getByText('Step 7 of 7')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  });

  it('lists every screen; turning one off gives it its own layout, turning it back on drops it', async () => {
    await renderTour();
    next();
    await heading('Choose your screens');
    expect(screen.getByText('2560 × 1080 · Primary')).toBeInTheDocument();
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Display 2' }));
    await waitFor(() => {
      expect(lastSaved().shell.monitors['\\\\.\\DISPLAY2']).toEqual({
        ...defaultSettings().shell.defaults,
        enabled: false,
      });
    });
    expect(screen.getByRole('switch', { name: 'Display 2' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('switch', { name: 'Display 2' }));
    await waitFor(() => {
      expect(lastSaved().shell.monitors).toEqual({});
    });
  });

  it('writes placement and shape as they are chosen and acts the placement out', async () => {
    await renderTour();
    next();
    next();
    await heading('Choose how it sits');
    expect(screen.getByRole('radio', { name: 'Overlay' })).toBeChecked();
    expect(screen.getByText(/steps aside while a title bar/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Reserved' }));
    await waitFor(() => {
      expect(lastSaved().shell.defaults.mode).toBe('reserved');
    });
    expect(screen.getByText(/Maximised windows stop below the strip/)).toBeInTheDocument();

    next();
    await heading('Pick a shape');
    fireEvent.click(screen.getByRole('radio', { name: 'Island' }));
    await waitFor(() => {
      expect(lastSaved().shell.defaults.shape).toBe('island');
    });
    expect(lastSaved().shell.defaults.mode).toBe('reserved');
  });

  it('turns launch at login on from the start-up step', async () => {
    await renderTour();
    for (let i = 0; i < 5; i += 1) {
      next();
    }
    await heading('Start with Windows');
    fireEvent.click(screen.getByRole('switch', { name: 'Launch at login' }));
    await waitFor(() => {
      expect(lastSaved().general.launchAtLogin).toBe(true);
    });
    expect(lastSaved().general.onboarded).toBe(false);
  });

  it('Finish marks the tour as seen and hands back to the window', async () => {
    const onDone = await renderTour();
    for (let i = 0; i < 6; i += 1) {
      next();
    }
    await heading('All set');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(lastSaved().general.onboarded).toBe(true);
    });
  });

  it('Skip does the same from the first step', async () => {
    const onDone = await renderTour();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(lastSaved().general.onboarded).toBe(true);
    });
  });

  it('does not save again when the tour is shown to a profile that has already seen it', async () => {
    const base = defaultSettings();
    ipc.commands.getSettings.mockResolvedValue({
      ...base,
      general: { ...base.general, onboarded: true },
    });
    const onDone = await renderTour();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(ipc.commands.updateSettings).not.toHaveBeenCalled();
  });

  it('skips the screens step on a single screen', async () => {
    ipc.commands.listMonitors.mockImplementation(() => ok([twoMonitors[0]!]));
    await renderTour();
    await waitFor(() => {
      expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    });
    next();
    await heading('Choose how it sits');
  });

  it('leaves the screens step out when the list fails', async () => {
    ipc.commands.listMonitors.mockImplementation(() =>
      Promise.resolve({ status: 'error', error: { code: 'monitors', message: 'no display' } }),
    );
    await renderTour();
    await waitFor(() => {
      expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    });
    next();
    await heading('Choose how it sits');
  });
});
