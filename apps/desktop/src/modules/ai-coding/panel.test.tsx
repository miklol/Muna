import type { AiCodingCommand, AiCodingSnapshot, IpcError } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useAiCodingStore } from './ai-coding-store';
import { AiCodingPanel } from './panel';
import {
  claudeWaiting,
  emptySnapshot,
  hooksMissingSnapshot,
  offSnapshot,
  SAMPLE_NOW,
  sampleSnapshot,
} from './sample-snapshot';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: AiCodingSnapshot }>[] = [];
  return {
    getAiCodingSnapshot: vi.fn<() => Promise<AiCodingSnapshot>>(),
    aiCodingWatch: vi.fn<(watching: boolean) => Promise<void>>(),
    aiCodingCommand: vi.fn<(command: AiCodingCommand) => Promise<IpcResult<AiCodingSnapshot>>>(),
    openSettings: vi.fn<() => Promise<void>>(),
    listen: vi.fn((callback: Listener<{ snapshot: AiCodingSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: AiCodingSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getAiCodingSnapshot: ipc.getAiCodingSnapshot,
    aiCodingWatch: ipc.aiCodingWatch,
    aiCodingCommand: ipc.aiCodingCommand,
    openSettings: ipc.openSettings,
  },
  events: {
    aiCodingChanged: { listen: ipc.listen },
  },
}));

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <AiCodingPanel />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const sessions = () => screen.getByRole('list', { name: 'Sessions' });

describe('AiCodingPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SAMPLE_NOW);
    useAiCodingStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.getAiCodingSnapshot.mockReset().mockResolvedValue(sampleSnapshot);
    ipc.aiCodingWatch.mockReset().mockResolvedValue(undefined);
    ipc.aiCodingCommand.mockReset();
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

  it('watches on mount, lists the sessions waiting first, and unwatches on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.aiCodingWatch).toHaveBeenCalledWith(true);
    expect(ipc.getAiCodingSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);

    expect(screen.getByText('3 active · 2 waiting')).toBeInTheDocument();
    const rows = within(sessions()).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAccessibleName('Claude Code, muna, Waiting');
    expect(rows[0]).toHaveTextContent('muna');
    expect(rows[0]).toHaveTextContent('Waiting');
    expect(rows[0]).toHaveTextContent('claude-sonnet-4.5');
    expect(rows[0]).toHaveTextContent('Wants to run Bash');
    expect(rows[0]).toHaveTextContent('pnpm -w test');
    expect(rows[0]).toHaveTextContent(
      'Claude Code · m4-e5-ai-coding · waiting for 40 s · 28 msgs · 50.4k tok',
    );
    expect(within(rows[0]!).getByRole('group', { name: 'Allow or deny' })).toBeInTheDocument();
    expect(
      within(rows[0]!).getByRole('button', { name: 'Bring the terminal of muna forward' }),
    ).toBeInTheDocument();
    expect(
      within(rows[0]!).queryByRole('button', { name: 'Dismiss muna' }),
    ).not.toBeInTheDocument();

    expect(rows[1]).toHaveTextContent('site');
    expect(rows[1]).toHaveTextContent('Waiting for your prompt');
    expect(rows[1]).toHaveTextContent('Claude Code · waiting for 9 min · 950 tok');
    expect(
      within(rows[1]!).queryByRole('group', { name: 'Allow or deny' }),
    ).not.toBeInTheDocument();
    expect(within(rows[1]!).getByRole('button', { name: 'Dismiss site' })).toBeInTheDocument();

    expect(rows[2]).toHaveTextContent('Muna');
    expect(rows[2]).toHaveTextContent('Running');
    expect(rows[2]).toHaveTextContent('CLI');
    expect(rows[2]).toHaveTextContent('Set up the desktop app scaffold with a fake platform layer');
    expect(rows[2]).toHaveTextContent('lib.rs');
    expect(rows[2]).toHaveTextContent('GitHub Copilot · main · running for 2 h 5 min · 412 msgs');

    const recent = screen.getByRole('region', { name: 'Recent' });
    expect(recent).toHaveTextContent('Muna');
    expect(recent).toHaveTextContent(/Finished 1:12\sPM · GitHub Copilot/);

    view.unmount();
    await flush();
    expect(ipc.aiCodingWatch).toHaveBeenLastCalledWith(false);
    expect(ipc.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers a permission prompt through Rust, dimming the pair until the answer lands', async () => {
    renderPanel();
    await flush();
    let resolve: ((result: IpcResult<AiCodingSnapshot>) => void) | undefined;
    ipc.aiCodingCommand.mockReturnValueOnce(
      new Promise<IpcResult<AiCodingSnapshot>>((done) => {
        resolve = done;
      }),
    );
    const pair = screen.getByRole('group', { name: 'Allow or deny' });
    fireEvent.click(within(pair).getByRole('button', { name: 'Allow' }));
    await flush();
    expect(ipc.aiCodingCommand).toHaveBeenCalledWith({
      kind: 'allow',
      session: 'claude:1f3c-permission',
    });
    expect(within(pair).getByRole('button', { name: 'Allow' })).toBeDisabled();
    expect(within(pair).getByRole('button', { name: 'Deny' })).toBeDisabled();

    const answered: AiCodingSnapshot = {
      ...sampleSnapshot,
      sessions: sampleSnapshot.sessions.map((session) =>
        session.id === claudeWaiting.id
          ? { ...session, status: 'running', waiting: null }
          : session,
      ),
    };
    resolve!({ status: 'ok', data: answered });
    await flush();
    expect(screen.queryByRole('group', { name: 'Allow or deny' })).not.toBeInTheDocument();
    expect(screen.getByText('3 active · 1 waiting')).toBeInTheDocument();
  });

  it('explains a refused answer in one line and keeps the list', async () => {
    renderPanel();
    await flush();
    ipc.aiCodingCommand.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'aiCoding.notWaiting', message: 'not waiting' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await flush();
    expect(ipc.aiCodingCommand).toHaveBeenCalledWith({
      kind: 'deny',
      session: 'claude:1f3c-permission',
    });
    expect(screen.getByRole('status')).toHaveTextContent('That session is not waiting any more.');
    expect(within(sessions()).getAllByRole('listitem')).toHaveLength(3);
  });

  it('brings a terminal forward, dismisses a session and asks for a refresh', async () => {
    renderPanel();
    await flush();
    ipc.aiCodingCommand.mockResolvedValue({ status: 'ok', data: sampleSnapshot });
    fireEvent.click(screen.getByRole('button', { name: 'Bring the terminal of muna forward' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();
    expect(ipc.aiCodingCommand.mock.calls.map(([command]) => command)).toEqual([
      { kind: 'focus', session: 'claude:1f3c-permission' },
      { kind: 'dismiss', session: 'claude:77a0-idle' },
      { kind: 'refresh' },
    ]);
  });

  it('follows the snapshots Rust publishes', async () => {
    renderPanel();
    await flush();
    act(() => {
      ipc.emit(emptySnapshot);
    });
    expect(screen.getByText('0 active')).toBeInTheDocument();
    expect(screen.getByText('No agents running')).toBeInTheDocument();
    expect(screen.getByText(/Start Claude Code or GitHub Copilot CLI/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open settings' })).not.toBeInTheDocument();
  });

  it('points at Settings when Claude Code has no hooks yet', async () => {
    ipc.getAiCodingSnapshot.mockResolvedValue(hooksMissingSnapshot);
    renderPanel();
    await flush();
    expect(screen.getByText(/install its hooks in Settings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
  });

  it('says the module is off and offers Settings', async () => {
    ipc.getAiCodingSnapshot.mockResolvedValue(offSnapshot);
    renderPanel();
    await flush();
    expect(screen.getByText('AI coding is off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
  });
});
