import type { CodeHostingSnapshot, IpcError, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  readCodeHostingSettings,
  writeCodeHostingSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { useCodeHostingStore } from './code-hosting-store';
import { CodeHostingSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getCodeHostingSnapshot: vi.fn<() => Promise<CodeHostingSnapshot>>(),
  codeHostingConnect: vi.fn<(token: string) => Promise<IpcResult<CodeHostingSnapshot>>>(),
  codeHostingDisconnect: vi.fn<() => Promise<CodeHostingSnapshot>>(),
  codeHostingOpenTokenPage: vi.fn<() => Promise<IpcResult<null>>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten from outside Tauri.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getCodeHostingSnapshot: ipc.getCodeHostingSnapshot,
    codeHostingConnect: ipc.codeHostingConnect,
    codeHostingDisconnect: ipc.codeHostingDisconnect,
    codeHostingOpenTokenPage: ipc.codeHostingOpenTokenPage,
  },
  events: { codeHostingChanged: { listen: ipc.listen } },
}));

const disconnected = (enabled: boolean): CodeHostingSnapshot => ({
  enabled,
  account: null,
  pullRequests: [],
  fetchedAtMs: null,
  fetching: false,
  error: null,
});

const connected = (): CodeHostingSnapshot => ({
  ...disconnected(true),
  account: { provider: 'gitHub', login: 'octocat', avatarUrl: null },
  fetchedAtMs: 0,
});

const enabledSettings = (): Settings =>
  writeCodeHostingSettings(defaultSettings(), {
    ...readCodeHostingSettings(defaultSettings()),
    enabled: true,
  });

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('CodeHostingSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useCodeHostingStore.setState({ snapshot: null, filter: 'toReview' });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getCodeHostingSnapshot.mockReset().mockResolvedValue(disconnected(false));
    ipc.codeHostingConnect.mockReset();
    ipc.codeHostingDisconnect.mockReset();
    ipc.codeHostingOpenTokenPage.mockReset().mockResolvedValue({ status: 'ok', data: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderPane = () => {
    const Host = () => {
      const settings = useSettings() ?? defaultSettings();
      return (
        <SettingsEditorProvider settings={settings}>
          <CodeHostingSettingsPane />
        </SettingsEditorProvider>
      );
    };
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <Host />
        </QueryClientProvider>
      </I18nextProvider>,
    );
  };

  const saved = () =>
    readCodeHostingSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  const tokenField = () => screen.getByLabelText('Access token');

  const typeToken = (value: string) => {
    fireEvent.change(tokenField(), { target: { value } });
  };

  it('starts off with the privacy note, the connect form and both notices on', async () => {
    renderPane();
    await flush();
    expect(screen.getByText(/stays in Windows Credential Manager/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show pull requests' })).not.toBeChecked();
    expect(tokenField()).toHaveAttribute('type', 'password');
    expect(tokenField()).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create a token' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Announce review requests' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Announce finished checks' })).toBeChecked();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('saves the switch and the notices through the settings document', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Show pull requests' }));
    await flush();
    expect(saved().enabled).toBe(true);

    fireEvent.click(screen.getByRole('switch', { name: 'Announce finished checks' }));
    await flush();
    expect(saved().notices).toEqual({ reviewRequested: true, checksFinished: false });
  });

  it('asks to turn the module on before sending a token anywhere', async () => {
    renderPane();
    await flush();
    typeToken('ghp_exampletoken');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Turn code hosting on first.');
    expect(ipc.codeHostingConnect).not.toHaveBeenCalled();
    // The token is still there: nothing was sent, so nothing needs re-pasting.
    expect(tokenField()).toHaveValue('ghp_exampletoken');
  });

  it('connects through Rust, clears the field and shows the account instead of the form', async () => {
    cacheSettings(queryClient, enabledSettings());
    ipc.getCodeHostingSnapshot.mockResolvedValue(disconnected(true));
    ipc.codeHostingConnect.mockResolvedValue({ status: 'ok', data: connected() });
    renderPane();
    await flush();
    typeToken('  ghp_exampletoken ');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await flush();

    expect(ipc.codeHostingConnect).toHaveBeenCalledWith('ghp_exampletoken');
    expect(screen.getByText('Connected as octocat')).toBeInTheDocument();
    expect(screen.getByText(/Signed in to GitHub/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Access token')).not.toBeInTheDocument();
    expect(screen.queryByText(/ghp_exampletoken/)).not.toBeInTheDocument();
    // The token never reaches the settings document.
    expect(ipc.updateSettings).not.toHaveBeenCalled();
  });

  it('explains a refused token in one line and clears the field', async () => {
    cacheSettings(queryClient, enabledSettings());
    ipc.getCodeHostingSnapshot.mockResolvedValue(disconnected(true));
    ipc.codeHostingConnect.mockResolvedValue({
      status: 'error',
      error: { code: 'codeHosting.unauthorized', message: 'refused' },
    });
    renderPane();
    await flush();
    typeToken('ghp_exampletoken');
    fireEvent.keyDown(tokenField(), { key: 'Enter' });
    await flush();
    expect(ipc.codeHostingConnect).toHaveBeenCalledWith('ghp_exampletoken');
    expect(screen.getByRole('status')).toHaveTextContent(
      'GitHub refused the token. Check that it can read your repositories and has not expired.',
    );
    expect(tokenField()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('opens the new-token page through Rust and disconnects through Rust', async () => {
    cacheSettings(queryClient, enabledSettings());
    ipc.getCodeHostingSnapshot.mockResolvedValue(connected());
    ipc.codeHostingDisconnect.mockResolvedValue(disconnected(true));
    renderPane();
    await flush();
    expect(screen.getByText('Connected as octocat')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await flush();
    expect(ipc.codeHostingDisconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Connected as octocat')).not.toBeInTheDocument();
    expect(tokenField()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create a token' }));
    await flush();
    expect(ipc.codeHostingOpenTokenPage).toHaveBeenCalledTimes(1);
  });
});
