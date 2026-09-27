import type { IpcError, ScreenTimeSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { emptySnapshot, sampleSnapshot } from './sample-snapshot';
import { useScreenTimeStore } from './screen-time-store';
import { ScreenTimeWidget } from './widget';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  getScreenTimeSnapshot: vi.fn<() => Promise<IpcResult<ScreenTimeSnapshot>>>(),
  screenTimeWatch: vi.fn<(watching: boolean) => Promise<void>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten from outside Tauri.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getScreenTimeSnapshot: ipc.getScreenTimeSnapshot,
    screenTimeWatch: ipc.screenTimeWatch,
  },
  events: { screenTimeChanged: { listen: ipc.listen } },
}));

const renderWidget = (span: 1 | 2) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ScreenTimeWidget span={span} />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });

describe('ScreenTimeWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useScreenTimeStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.getScreenTimeSnapshot.mockReset().mockResolvedValue({
      status: 'ok',
      data: sampleSnapshot(),
    });
    ipc.screenTimeWatch.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the donut, the total and the app in front on a narrow card', async () => {
    renderWidget(1);
    await flush();
    expect(ipc.screenTimeWatch).toHaveBeenCalledWith(true);
    const card = screen.getByLabelText('Screen time');
    expect(
      within(card).getByRole('img', { name: '3 h 46 min today across 5 categories' }),
    ).toBeInTheDocument();
    expect(within(card).getByText('3 h 46 min')).toBeInTheDocument();
    expect(within(card).getByText('Visual Studio Code')).toBeInTheDocument();
    expect(within(card).queryByRole('list', { name: 'Apps' })).not.toBeInTheDocument();
  });

  it('adds the leading apps on a wide card', async () => {
    renderWidget(2);
    await flush();
    const apps = screen.getByRole('list', { name: 'Apps' });
    expect(
      within(apps)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['Visual Studio Code2 h 5 min', 'Microsoft Edge58 min', 'Microsoft Teams27 min']);
  });

  it('says when the count is paused, off, or has nothing yet', async () => {
    ipc.getScreenTimeSnapshot.mockResolvedValue({
      status: 'ok',
      data: sampleSnapshot({ now: null, tracking: 'idle' }),
    });
    renderWidget(1);
    await flush();
    expect(screen.getByText('Away')).toBeInTheDocument();

    act(() => {
      useScreenTimeStore.getState().setSnapshot(sampleSnapshot({ now: null, tracking: 'locked' }));
    });
    expect(screen.getByText('Locked')).toBeInTheDocument();

    act(() => {
      useScreenTimeStore.getState().setSnapshot(emptySnapshot({ tracking: 'off' }));
    });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    act(() => {
      useScreenTimeStore.getState().setSnapshot(emptySnapshot());
    });
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });

  it('renders nothing before the first snapshot and unwatches on unmount', () => {
    ipc.getScreenTimeSnapshot.mockReturnValue(new Promise(() => undefined));
    const view = renderWidget(1);
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
    expect(ipc.screenTimeWatch).toHaveBeenLastCalledWith(false);
  });
});
