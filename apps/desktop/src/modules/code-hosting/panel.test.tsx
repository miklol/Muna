import type {
  CodeHostingCommand,
  CodeHostingSnapshot,
  IpcError,
  PullRequest,
} from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useCodeHostingStore } from './code-hosting-store';
import { CodeHostingPanel } from './panel';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: CodeHostingSnapshot }>[] = [];
  return {
    getCodeHostingSnapshot: vi.fn<() => Promise<CodeHostingSnapshot>>(),
    codeHostingCommand: vi.fn<(command: CodeHostingCommand) => Promise<CodeHostingSnapshot>>(),
    codeHostingOpen: vi.fn<(id: string) => Promise<IpcResult<null>>>(),
    openSettings: vi.fn<() => Promise<void>>(),
    listen: vi.fn((callback: Listener<{ snapshot: CodeHostingSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: CodeHostingSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getCodeHostingSnapshot: ipc.getCodeHostingSnapshot,
    codeHostingCommand: ipc.codeHostingCommand,
    codeHostingOpen: ipc.codeHostingOpen,
    openSettings: ipc.openSettings,
  },
  events: {
    codeHostingChanged: { listen: ipc.listen },
  },
}));

const NOW = new Date(2026, 8, 27, 10, 6);
const FETCHED_AT = new Date(2026, 8, 27, 10, 5).getTime();

const row = (overrides: Partial<PullRequest> & Pick<PullRequest, 'id' | 'title'>): PullRequest => ({
  provider: 'gitHub',
  repo: 'miklol/Muna',
  number: 41,
  url: 'https://github.com/miklol/Muna/pull/41',
  author: 'sam-k',
  authorAvatarUrl: null,
  draft: false,
  additions: 64,
  deletions: 51,
  changedFiles: 6,
  checks: 'pending',
  reviewDecision: 'none',
  updatedAtMs: FETCHED_AT,
  reviewRequested: true,
  mine: false,
  ...overrides,
});

const snapZones = row({
  id: 'PR_1',
  title: 'Snap zones',
  checks: 'failure',
  reviewDecision: 'reviewRequired',
});
const draft = row({
  id: 'PR_2',
  title: 'Retry the fetch',
  repo: 'octo-org/infra',
  number: 7,
  author: 'priya',
  draft: true,
  checks: 'none',
});
const mine = row({
  id: 'PR_4',
  title: 'Review queue',
  number: 42,
  author: 'octocat',
  reviewRequested: false,
  mine: true,
});

const snapshot = (overrides: Partial<CodeHostingSnapshot> = {}): CodeHostingSnapshot => ({
  enabled: true,
  account: { provider: 'gitHub', login: 'octocat', avatarUrl: null },
  pullRequests: [snapZones, draft, mine],
  fetchedAtMs: FETCHED_AT,
  fetching: false,
  error: null,
  ...overrides,
});

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <CodeHostingPanel />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const queue = () => screen.getByRole('region', { name: 'Pull requests' });

describe('CodeHostingPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useCodeHostingStore.setState({ snapshot: null, filter: 'toReview' });
    ipc.getCodeHostingSnapshot.mockReset().mockResolvedValue(snapshot());
    ipc.codeHostingCommand.mockReset();
    ipc.codeHostingOpen.mockReset().mockResolvedValue({ status: 'ok', data: null });
    ipc.openSettings.mockReset().mockResolvedValue(undefined);
    ipc.listen.mockClear();
  });

  afterEach(async () => {
    cleanup();
    // Let Motion's frame loop run the frame it scheduled before the timers go real.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  it('subscribes on mount, lists what waits for a review, and unlistens on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.getCodeHostingSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);

    const filters = screen.getByRole('group', { name: 'Show' });
    expect(within(filters).getByRole('button', { name: 'To review' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(queue()).toHaveTextContent('2 pull requests');
    const rows = within(queue()).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Snap zones');
    expect(rows[0]).toHaveTextContent('miklol/Muna #41');
    expect(rows[0]).toHaveTextContent('by sam-k');
    expect(rows[0]).toHaveTextContent('GitHub');
    expect(rows[0]).toHaveTextContent('+64 −51 · 6 files · Checks failed · Review required');
    expect(rows[0]).toHaveTextContent('S');
    expect(rows[1]).toHaveTextContent('Retry the fetch');
    expect(rows[1]).toHaveAttribute('data-draft');
    expect(within(rows[1]!).getByLabelText('Draft')).toBeInTheDocument();
    expect(screen.queryByText('Review queue')).not.toBeInTheDocument();
    expect(screen.getByText(/^Updated 10:05\sAM$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();

    view.unmount();
    await flush();
    expect(ipc.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('switches between what waits, what is mine and everything without saving anything', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(within(queue()).getAllByRole('listitem')).toHaveLength(1);
    expect(queue()).toHaveTextContent('Review queue');
    expect(queue()).toHaveTextContent('1 pull request');
    expect(useCodeHostingStore.getState().filter).toBe('mine');

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(within(queue()).getAllByRole('listitem')).toHaveLength(3);
    expect(queue()).toHaveTextContent('3 pull requests');
  });

  it('opens a pull request through Rust and asks for a refresh', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Open Snap zones on GitHub' }));
    await flush();
    expect(ipc.codeHostingOpen).toHaveBeenCalledWith('PR_1');

    ipc.codeHostingCommand.mockResolvedValue(snapshot({ fetching: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();
    expect(ipc.codeHostingCommand).toHaveBeenCalledWith({ kind: 'refresh' });
    expect(screen.getByRole('button', { name: 'Refreshing' })).toBeDisabled();
  });

  it('follows the events: a new poll replaces the rows, a failed one keeps them and explains', async () => {
    renderPanel();
    await flush();
    act(() => {
      ipc.emit(snapshot({ pullRequests: [snapZones], fetchedAtMs: FETCHED_AT + 120_000 }));
    });
    expect(within(queue()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/^Updated 10:07\sAM$/)).toBeInTheDocument();

    act(() => {
      ipc.emit(snapshot({ pullRequests: [snapZones], error: 'offline' }));
    });
    expect(within(queue()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/^Offline, showing the queue from 10:05\sAM$/)).toBeInTheDocument();

    act(() => {
      ipc.emit(snapshot({ error: 'unauthorized' }));
    });
    expect(
      screen.getByText('GitHub no longer accepts the token. Connect again in Settings.'),
    ).toBeInTheDocument();
  });

  it('says what would bring a row here when nothing waits', async () => {
    ipc.getCodeHostingSnapshot.mockResolvedValue(snapshot({ pullRequests: [mine] }));
    renderPanel();
    await flush();
    expect(screen.getByText('Nothing to review')).toBeInTheDocument();
    expect(queue()).toHaveTextContent('0 pull requests');
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(screen.getByText('Review queue')).toBeInTheDocument();
  });

  it('points at Settings while off or without an account', async () => {
    ipc.getCodeHostingSnapshot.mockResolvedValue(
      snapshot({ enabled: false, account: null, pullRequests: [], fetchedAtMs: null }),
    );
    renderPanel();
    await flush();
    expect(screen.getByText('Code hosting is off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);

    act(() => {
      ipc.emit(snapshot({ account: null, pullRequests: [], fetchedAtMs: null }));
    });
    expect(screen.getByText('No account connected')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pull requests' })).not.toBeInTheDocument();
  });
});
