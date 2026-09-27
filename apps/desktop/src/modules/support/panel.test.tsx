import type { IpcError, SupportCommand, SupportLink, SupportOutcome, SupportSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { bundleName, SupportPanel } from './panel';
import { sampleSnapshot } from './sample-snapshot';
import { useSupportStore } from './support-store';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: SupportSnapshot }>[] = [];
  return {
    getSupportSnapshot: vi.fn<() => Promise<IpcResult<SupportSnapshot>>>(),
    supportCommand: vi.fn<(command: SupportCommand) => Promise<IpcResult<SupportOutcome>>>(),
    supportOpen: vi.fn<(link: SupportLink) => Promise<IpcResult<null>>>(),
    supportChangelog: vi.fn<() => Promise<string | null>>(),
    listen: vi.fn((callback: Listener<{ snapshot: SupportSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: SupportSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getSupportSnapshot: ipc.getSupportSnapshot,
    supportCommand: ipc.supportCommand,
    supportOpen: ipc.supportOpen,
    supportChangelog: ipc.supportChangelog,
  },
  events: { supportChanged: { listen: ipc.listen } },
}));

const CHANGELOG = `# Changelog

## [0.3.0](https://github.com/miklol/Muna/compare/v0.2.0...v0.3.0) (2026-09-27)

### Features

* **support:** help and diagnostics ([cd3fc86](https://github.com/miklol/Muna/commit/cd3fc86))
`;

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <SupportPanel />
    </I18nextProvider>,
  );

describe('SupportPanel', () => {
  beforeEach(() => {
    useSupportStore.setState({ snapshot: null });
    ipc.getSupportSnapshot.mockReset().mockResolvedValue({ status: 'ok', data: sampleSnapshot() });
    ipc.supportCommand.mockReset().mockResolvedValue({ status: 'ok', data: { kind: 'done' } });
    ipc.supportOpen.mockReset().mockResolvedValue({ status: 'ok', data: null });
    ipc.supportChangelog.mockReset().mockResolvedValue(CHANGELOG);
    ipc.listen.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('names the build and the machine, then lists the six things to do', async () => {
    renderPanel();
    await flush();
    expect(screen.getByText('Muna 0.3.0 · Windows 11 Pro (build 26200)')).toBeInTheDocument();
    for (const name of [
      'Help',
      'Send feedback',
      'Save diagnostics',
      "What's new",
      'Repair',
      'Rate Muna on GitHub',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`, 'u') })).toBeEnabled();
    }
    expect(ipc.getSupportSnapshot).toHaveBeenCalledTimes(1);
  });

  it('opens help, feedback and the GitHub page through Rust', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /^Help/u }));
    fireEvent.click(screen.getByRole('button', { name: /^Send feedback/u }));
    fireEvent.click(screen.getByRole('button', { name: /^Rate Muna/u }));
    await flush();
    expect(ipc.supportOpen.mock.calls.map(([link]) => link)).toEqual(['help', 'feedback', 'rate']);
  });

  it('saves a diagnostics bundle and names the file it wrote', async () => {
    ipc.supportCommand.mockResolvedValue({
      status: 'ok',
      data: {
        kind: 'bundle',
        path: 'C:\\Users\\sam\\Desktop\\muna-diagnostics-20260927-1030.zip',
        entries: 5,
        atMs: 0,
      },
    });
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /^Save diagnostics/u }));
    await flush();
    expect(ipc.supportCommand).toHaveBeenCalledWith({ kind: 'diagnostics' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Saved muna-diagnostics-20260927-1030.zip to your Desktop. Attach it to your issue.',
    );
  });

  it('explains a refused bundle in one line', async () => {
    ipc.supportCommand.mockResolvedValue({
      status: 'error',
      error: { code: 'support.noDesktop', message: 'desktop folder not found' },
    });
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /^Save diagnostics/u }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your Desktop folder cannot be found, so the bundle was not saved.',
    );
  });

  it('shows the bundled changelog in place, without commit hashes, and the way back', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /^What's new/u }));
    await flush();
    expect(ipc.supportChangelog).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: "What's new" })).toBeInTheDocument();
    expect(screen.getByText('0.3.0')).toBeInTheDocument();
    expect(screen.getByText('2026-09-27')).toBeInTheDocument();
    expect(screen.getByText('Features')).toBeInTheDocument();
    expect(screen.getByText('support: help and diagnostics')).toBeInTheDocument();
    expect(screen.queryByText(/cd3fc86/u)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release notes on GitHub' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /^Help/u })).toBeInTheDocument();
  });

  it('opens the release notes on GitHub when no changelog ships with the build', async () => {
    ipc.getSupportSnapshot.mockResolvedValue({
      status: 'ok',
      data: sampleSnapshot({ changelog: false }),
    });
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /^What's new/u }));
    await flush();
    expect(ipc.supportChangelog).not.toHaveBeenCalled();
    expect(ipc.supportOpen).toHaveBeenCalledWith('releaseNotes');
  });

  it('runs the two repairs from their own view and reports each', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /^Repair/u }));
    const buttons = screen.getAllByRole('button', { name: 'Repair' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons.at(0)!);
    await flush();
    expect(ipc.supportCommand).toHaveBeenLastCalledWith({ kind: 'repairFlyouts' });
    expect(screen.getByRole('status')).toHaveTextContent('Flyouts repaired.');
    fireEvent.click(buttons.at(1)!);
    await flush();
    expect(ipc.supportCommand).toHaveBeenLastCalledWith({ kind: 'repairAppBar' });
    expect(screen.getByRole('status')).toHaveTextContent('Reserved space repaired.');
  });

  it('follows SupportChanged and stops listening when unmounted', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.listenerCount()).toBe(1);
    act(() => {
      ipc.emit(sampleSnapshot({ version: '0.4.0' }));
    });
    expect(screen.getByText('Version 0.4.0')).toBeInTheDocument();
    view.unmount();
    expect(ipc.listenerCount()).toBe(0);
  });

  it('renders nothing until the first snapshot arrives', () => {
    ipc.getSupportSnapshot.mockReturnValue(new Promise(() => undefined));
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('bundleName', () => {
  it('takes the file name off a Windows or POSIX path', () => {
    expect(bundleName('C:\\Users\\sam\\Desktop\\muna-diagnostics-20260927-1030.zip')).toBe(
      'muna-diagnostics-20260927-1030.zip',
    );
    expect(bundleName('/tmp/x.zip')).toBe('x.zip');
    expect(bundleName('x.zip')).toBe('x.zip');
  });
});
