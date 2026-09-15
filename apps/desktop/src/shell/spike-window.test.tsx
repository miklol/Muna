import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../app-providers';
import { PANEL_SHAPE, STRIP_SHAPE, SpikeWindow } from './spike-window';

type MorphListener = (event: { payload: { expanded: boolean } }) => void;

const ipc = vi.hoisted(() => ({
  shellReady: vi.fn(() => Promise.resolve({ status: 'ok', data: null })),
  publishShapeRects: vi.fn(() => Promise.resolve({ status: 'ok', data: null })),
  reportMorph: vi.fn(() => Promise.resolve({ status: 'ok', data: null })),
  listeners: [] as MorphListener[],
}));

vi.mock('@muna/contracts', () => ({
  commands: {
    shellReady: ipc.shellReady,
    publishShapeRects: ipc.publishShapeRects,
    reportMorph: ipc.reportMorph,
  },
  events: {
    morphRequested: {
      listen: vi.fn((listener: MorphListener) => {
        ipc.listeners.push(listener);
        return Promise.resolve(() => undefined);
      }),
    },
  },
}));

describe('SpikeWindow', () => {
  beforeEach(() => {
    ipc.shellReady.mockClear();
    ipc.publishShapeRects.mockClear();
    ipc.reportMorph.mockClear();
    ipc.listeners.length = 0;
  });

  it('reports ready after the first painted frames and publishes the strip shape', async () => {
    render(
      <AppProviders>
        <SpikeWindow />
      </AppProviders>,
    );
    await waitFor(() => {
      expect(ipc.shellReady).toHaveBeenCalledTimes(1);
    });
    expect(ipc.publishShapeRects).toHaveBeenCalledTimes(1);
    const [rects] = ipc.publishShapeRects.mock.calls[0] as unknown as [unknown[]];
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual(
      expect.objectContaining({ x: expect.any(Number), width: expect.any(Number) }),
    );
  });

  it('starts as the strip and morphs into the panel on MorphRequested', async () => {
    render(
      <AppProviders>
        <SpikeWindow />
      </AppProviders>,
    );
    const shape = screen.getByRole('region', { name: 'Strip' });
    expect(shape).toHaveAttribute('data-expanded', 'false');
    await waitFor(() => {
      expect(ipc.listeners).toHaveLength(1);
    });

    ipc.listeners[0]?.({ payload: { expanded: true } });

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Panel' })).toHaveAttribute(
        'data-expanded',
        'true',
      );
    });
    expect(PANEL_SHAPE.width).toBeGreaterThan(STRIP_SHAPE.width);
  });
});
