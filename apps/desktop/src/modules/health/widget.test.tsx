import type { HealthCommand, HealthSnapshot, IpcError } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { MINUTE_MS, SECOND_MS } from './format';
import { useHealthStore } from './health-store';
import { emptySnapshot, SAMPLE_NOW_MS, sampleSnapshot } from './sample-snapshot';
import { HealthWidget } from './widget';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ok = <T,>(data: T): IpcResult<T> => ({ status: 'ok', data });

const ipc = vi.hoisted(() => ({
  getHealthSnapshot: vi.fn(() => new Promise<never>(() => undefined)),
  healthCommand: vi.fn<(command: HealthCommand) => Promise<IpcResult<HealthSnapshot>>>(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getHealthSnapshot: ipc.getHealthSnapshot,
    healthCommand: ipc.healthCommand,
  },
  events: { healthChanged: { listen: ipc.listen } },
}));

const renderWidget = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <HealthWidget span={1} />
    </I18nextProvider>,
  );

const publish = (snapshot: HealthSnapshot) => {
  act(() => {
    useHealthStore.getState().setSnapshot(snapshot, Date.now());
  });
};

describe('HealthWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SAMPLE_NOW_MS);
    useHealthStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.healthCommand.mockReset().mockImplementation((command) => {
      const base = sampleSnapshot();
      return Promise.resolve(
        ok(
          command.kind === 'water'
            ? sampleSnapshot({ today: { ...base.today, water: base.today.water + command.delta } })
            : base,
        ),
      );
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing before the first snapshot', () => {
    const { container } = renderWidget();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the small rings, the sit and the next reminder, counting up while sitting', async () => {
    publish(sampleSnapshot());
    renderWidget();
    expect(screen.getByText('Sitting 34 min')).toBeInTheDocument();
    expect(screen.getByText('Next break in 16 min')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Breaks' })).toHaveAttribute(
      'aria-valuetext',
      '4 of 7 breaks',
    );
    expect(screen.getByRole('meter', { name: 'Water' })).toHaveAttribute(
      'aria-valuetext',
      '7 of 8 glasses',
    );
    expect(screen.getByRole('meter', { name: 'Mindful' })).toHaveAttribute(
      'aria-valuetext',
      '0 of 10 mindful minutes',
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * MINUTE_MS);
    });
    expect(screen.getByText('Sitting 36 min')).toBeInTheDocument();
    expect(screen.getByText('Next break in 14 min')).toBeInTheDocument();
  });

  it('says when a break is due, when a flow runs and why the timer is paused', async () => {
    publish(sampleSnapshot({ nextBreakInMs: null, breakDueSinceMs: SAMPLE_NOW_MS }));
    renderWidget();
    expect(screen.getByText('Time for a break')).toBeInTheDocument();

    publish(
      sampleSnapshot({
        nextBreakInMs: null,
        flow: {
          flow: 'eyeRest',
          startedMs: SAMPLE_NOW_MS,
          remainingMs: 20 * SECOND_MS,
          totalMs: 20 * SECOND_MS,
          pattern: 'box',
        },
      }),
    );
    expect(screen.getByText('Eye rest running')).toBeInTheDocument();
    expect(screen.getByText('0:20 left')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * SECOND_MS);
    });
    expect(screen.getByText('0:17 left')).toBeInTheDocument();

    publish(sampleSnapshot({ sitting: 'away', nextBreakInMs: null }));
    expect(screen.getByText('Away from the desk')).toBeInTheDocument();
    expect(screen.getByText('7 of 8 glasses')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);

    publish(sampleSnapshot({ sitting: 'locked', nextBreakInMs: null }));
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('logs a glass of water and disables the button while health is off', async () => {
    publish(sampleSnapshot());
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: 'Add a glass of water' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(ipc.healthCommand).toHaveBeenCalledWith({ kind: 'water', delta: 1 });
    expect(screen.getByRole('meter', { name: 'Water' })).toHaveAttribute(
      'aria-valuetext',
      '8 of 8 glasses',
    );

    publish(emptySnapshot({ sitting: 'off', enabled: false, nextBreakInMs: null }));
    expect(screen.getByText('Health is off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a glass of water' })).toBeDisabled();
  });
});
