import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../app-providers';
import { queryClient } from '../lib/query-client';
import { ShellRoot } from './shell-root';

const ipc = vi.hoisted(() => ({
  getShellMode: vi.fn<() => Promise<'normal' | 'spikeWindow'>>(),
}));

vi.mock('@muna/contracts', () => ({
  commands: {
    getShellMode: ipc.getShellMode,
    shellReady: vi.fn(() => Promise.resolve({ status: 'ok', data: null })),
    publishShapeRects: vi.fn(() => Promise.resolve({ status: 'ok', data: null })),
    reportMorph: vi.fn(() => Promise.resolve({ status: 'ok', data: null })),
  },
  events: {
    stripContentChanged: { listen: vi.fn(() => Promise.resolve(() => undefined)) },
    morphRequested: { listen: vi.fn(() => Promise.resolve(() => undefined)) },
  },
}));

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
    expect(await screen.findByRole('status')).toHaveAttribute('data-kind', 'idle');
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
