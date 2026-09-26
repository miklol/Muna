import type * as Contracts from '@muna/contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../app-providers';
import { queryClient } from '../lib/query-client';
import { ShellRoot } from './shell-root';

const ipc = vi.hoisted(() => ({
  getShellMode: vi.fn<() => Promise<'normal' | 'spikeWindow'>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => {
  const original = await importOriginal<typeof Contracts>();
  const ok = () => Promise.resolve({ status: 'ok' as const, data: null });
  const silent = { listen: vi.fn(() => Promise.resolve(() => undefined)) };
  return {
    ...original,
    commands: {
      getShellMode: ipc.getShellMode,
      getShellLayout: vi.fn(ok),
      shellReady: vi.fn(ok),
      publishShapeRects: vi.fn(ok),
      setNotchFocusable: vi.fn(ok),
      reportMorph: vi.fn(ok),
      getSettings: vi.fn(() => Promise.resolve(original.defaultSettings())),
    },
    events: {
      stripContentChanged: silent,
      shellLayoutChanged: silent,
      shellYieldChanged: silent,
      hotkeyPressed: silent,
      shellPointerDownOutside: silent,
      morphRequested: silent,
      settingsChanged: silent,
    },
  };
});

describe('ShellRoot', () => {
  beforeEach(() => {
    ipc.getShellMode.mockReset();
    // AppProviders shares one module-level client; drop the cached mode between tests.
    queryClient.clear();
  });

  it('renders the product shell in normal mode', async () => {
    ipc.getShellMode.mockResolvedValue('normal');
    render(
      <AppProviders>
        <ShellRoot />
      </AppProviders>,
    );
    const strip = await screen.findByRole('region', { name: 'Notch strip' });
    expect(strip).toHaveAttribute('data-kind', 'idle');
    expect(screen.getByRole('main')).toHaveAttribute('data-state', 'collapsed');
  });

  it('renders the spike when Rust reports spikeWindow', async () => {
    ipc.getShellMode.mockResolvedValue('spikeWindow');
    const { unmount } = render(
      <AppProviders>
        <ShellRoot />
      </AppProviders>,
    );
    expect(await screen.findByRole('region', { name: 'Strip' })).toBeInTheDocument();
    unmount();
  });
});
