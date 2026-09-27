import type { AiCodingCommand, AiCodingSnapshot, IpcError, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readAiCodingSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { useAiCodingStore } from './ai-coding-store';
import { emptySnapshot, hooksMissingSnapshot, offSnapshot } from './sample-snapshot';
import { AiCodingSettingsPane, parsePort } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getAiCodingSnapshot: vi.fn<() => Promise<AiCodingSnapshot>>(),
  aiCodingWatch: vi.fn<(watching: boolean) => Promise<void>>(),
  aiCodingCommand: vi.fn<(command: AiCodingCommand) => Promise<IpcResult<AiCodingSnapshot>>>(),
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
    getAiCodingSnapshot: ipc.getAiCodingSnapshot,
    aiCodingWatch: ipc.aiCodingWatch,
    aiCodingCommand: ipc.aiCodingCommand,
  },
  events: { aiCodingChanged: { listen: ipc.listen } },
}));

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('parsePort', () => {
  it('accepts a whole number inside the receiver range and nothing else', () => {
    expect(parsePort('47391')).toBe(47_391);
    expect(parsePort(' 1024 ')).toBe(1024);
    expect(parsePort('65525')).toBe(65_525);
    expect(parsePort('65526')).toBeNull();
    expect(parsePort('1023')).toBeNull();
    expect(parsePort('80')).toBeNull();
    expect(parsePort('4739a')).toBeNull();
    expect(parsePort('')).toBeNull();
    expect(parsePort('-1')).toBeNull();
  });
});

describe('AiCodingSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useAiCodingStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getAiCodingSnapshot.mockReset().mockResolvedValue(hooksMissingSnapshot);
    ipc.aiCodingWatch.mockReset().mockResolvedValue(undefined);
    ipc.aiCodingCommand.mockReset();
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
          <AiCodingSettingsPane />
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
    readAiCodingSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  const portField = () => screen.getByLabelText('Port');

  it('starts on with the privacy note, the default port, the receiver listening and hooks to install', async () => {
    renderPane();
    await flush();
    expect(screen.getByText(/hooks arrive on 127\.0\.0\.1 only/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Watch coding agents' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'GitHub Copilot CLI' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Announce waiting agents' })).toBeChecked();
    expect(portField()).toHaveValue('47391');
    expect(portField()).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByText('Between 1024 and 65525.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Listening on port 47391')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:47391/hooks/claude')).toBeInTheDocument();
    expect(screen.getByText(/Adds HTTP hooks to Claude Code's settings/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install hooks' })).toBeEnabled();
  });

  it('saves the switches through the settings document', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Announce waiting agents' }));
    await flush();
    expect(saved().waitingNotice).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: 'GitHub Copilot CLI' }));
    await flush();
    expect(saved().copilotCli).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Watch coding agents' }));
    await flush();
    expect(saved().enabled).toBe(false);
  });

  it('commits a valid port on Enter or blur and drops one the receiver could not bind', async () => {
    renderPane();
    await flush();
    fireEvent.change(portField(), { target: { value: '5000' } });
    fireEvent.keyDown(portField(), { key: 'Enter' });
    await flush();
    expect(saved().port).toBe(5000);
    expect(portField()).toHaveValue('5000');

    fireEvent.change(portField(), { target: { value: '80' } });
    fireEvent.blur(portField());
    await flush();
    expect(saved().port).toBe(5000);
    expect(portField()).toHaveValue('5000');

    fireEvent.change(portField(), { target: { value: '6100' } });
    fireEvent.blur(portField());
    await flush();
    expect(saved().port).toBe(6100);
  });

  it('installs the Claude Code hooks through Rust and says so, then offers to remove them', async () => {
    ipc.aiCodingCommand.mockResolvedValueOnce({ status: 'ok', data: emptySnapshot });
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Install hooks' }));
    await flush();
    expect(ipc.aiCodingCommand).toHaveBeenCalledWith({ kind: 'installClaudeHooks' });
    expect(screen.getByText(/Hooks installed\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove hooks' })).toBeEnabled();

    ipc.aiCodingCommand.mockResolvedValueOnce({ status: 'ok', data: hooksMissingSnapshot });
    fireEvent.click(screen.getByRole('button', { name: 'Remove hooks' }));
    await flush();
    expect(ipc.aiCodingCommand).toHaveBeenLastCalledWith({ kind: 'removeClaudeHooks' });
    expect(screen.getByText('Hooks removed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install hooks' })).toBeEnabled();
  });

  it('explains a refused hooks write in the row', async () => {
    ipc.aiCodingCommand.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'aiCoding.hooksFile', message: 'bad json' },
    });
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Install hooks' }));
    await flush();
    expect(screen.getByText(/settings file could not be changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install hooks' })).toBeEnabled();
  });

  it('shows the receiver stopped when the module is off and keeps the hooks button quiet', async () => {
    ipc.getAiCodingSnapshot.mockResolvedValue(offSnapshot);
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Watch coding agents' }));
    await flush();
    expect(screen.getByText('Not listening')).toBeInTheDocument();
    expect(
      screen.getByText(/The module is off or the port could not be bound/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install hooks' })).toBeDisabled();
  });
});
