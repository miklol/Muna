import type { IpcError, Settings, TranslationSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  readTranslationSettings,
  writeTranslationSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { TranslationSettingsPane } from './settings';
import { idleResult, useTranslationStore } from './translation-store';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getTranslationSnapshot: vi.fn<() => Promise<TranslationSnapshot>>(),
  translationSetKey: vi.fn<(key: string) => Promise<IpcResult<TranslationSnapshot>>>(),
  translationClearKey: vi.fn<() => Promise<IpcResult<TranslationSnapshot>>>(),
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
    getTranslationSnapshot: ipc.getTranslationSnapshot,
    translationSetKey: ipc.translationSetKey,
    translationClearKey: ipc.translationClearKey,
  },
  events: {
    translationChanged: { listen: ipc.listen },
    translationChunkEvent: { listen: ipc.listen },
  },
}));

const snapshot = (overrides: Partial<TranslationSnapshot> = {}): TranslationSnapshot => ({
  enabled: false,
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  hasKey: false,
  needsKey: true,
  active: 0,
  ...overrides,
});

const withTranslation = (overrides: Partial<Contracts.TranslationSettings>): Settings =>
  writeTranslationSettings(defaultSettings(), {
    ...readTranslationSettings(defaultSettings()),
    ...overrides,
  });

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('TranslationSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useTranslationStore.setState({
      snapshot: null,
      draft: '',
      result: idleResult(),
      focusRequested: false,
    });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getTranslationSnapshot.mockReset().mockResolvedValue(snapshot());
    ipc.translationSetKey.mockReset();
    ipc.translationClearKey.mockReset();
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
          <TranslationSettingsPane />
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
    readTranslationSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  const keyField = () => screen.getByLabelText('API key', { selector: 'input' });

  it('starts off with the privacy note, OpenAI-compatible, blank fields and the key form', async () => {
    renderPane();
    await flush();
    expect(screen.getByText(/stays in Windows Credential Manager/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Translate text' })).not.toBeChecked();
    expect(screen.getByText('Sends the text you enter to api.openai.com.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'OpenAI-compatible' })).toBeChecked();
    expect(screen.getByLabelText('Endpoint')).toHaveValue('');
    expect(screen.getByLabelText('Endpoint')).toHaveAttribute(
      'placeholder',
      'https://api.openai.com/v1',
    );
    expect(screen.getByLabelText('Model')).toHaveAttribute('placeholder', 'gpt-4o-mini');
    expect(screen.getByText('Leave blank for gpt-4o-mini.')).toBeInTheDocument();
    expect(keyField()).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Detect language')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('saves the switch, and commits the endpoint and model once on Enter or blur', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Translate text' }));
    await flush();
    expect(saved().enabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Endpoint'), {
      target: { value: ' http://127.0.0.1:1234/v1 ' },
    });
    await flush();
    expect(saved().endpoint).toBe('');
    fireEvent.keyDown(screen.getByLabelText('Endpoint'), { key: 'Enter' });
    await flush();
    expect(saved().endpoint).toBe('http://127.0.0.1:1234/v1');
    expect(screen.getByText('Sends the text you enter to 127.0.0.1:1234.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'qwen2.5' } });
    fireEvent.blur(screen.getByLabelText('Model'));
    await flush();
    expect(saved().model).toBe('qwen2.5');
    expect(screen.getByText('Leave blank for qwen2.5.')).toBeInTheDocument();
  });

  it('switching the provider clears the endpoint and model and changes the key note', async () => {
    cacheSettings(
      queryClient,
      withTranslation({ endpoint: 'https://openrouter.ai/api/v1', model: 'x' }),
    );
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('radio', { name: 'Ollama' }));
    await flush();
    expect(saved()).toMatchObject({ provider: 'ollama', endpoint: '', model: '' });
    expect(screen.getByLabelText('Endpoint')).toHaveAttribute(
      'placeholder',
      'http://127.0.0.1:11434',
    );
    expect(screen.getByText('Optional; most local servers need none.')).toBeInTheDocument();
  });

  it('saves a key through Rust, clears the field and shows Remove instead', async () => {
    ipc.translationSetKey.mockResolvedValue({ status: 'ok', data: snapshot({ hasKey: true }) });
    renderPane();
    await flush();
    fireEvent.change(keyField(), { target: { value: '  sk-example ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(ipc.translationSetKey).toHaveBeenCalledWith('sk-example');
    expect(screen.queryByLabelText('API key', { selector: 'input' })).not.toBeInTheDocument();
    expect(screen.getByText(/A key is saved for OpenAI-compatible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(screen.queryByText(/sk-example/)).not.toBeInTheDocument();
    // The key never reaches the settings document.
    expect(ipc.updateSettings).not.toHaveBeenCalled();
  });

  it('explains a refused key in one line and clears the field', async () => {
    ipc.translationSetKey.mockResolvedValue({
      status: 'error',
      error: { code: 'translation.key.malformed', message: 'nope' },
    });
    renderPane();
    await flush();
    fireEvent.change(keyField(), { target: { value: 'not a key' } });
    fireEvent.keyDown(keyField(), { key: 'Enter' });
    await flush();
    expect(screen.getByText('That does not look like a key. Paste it again.')).toBeInTheDocument();
    expect(keyField()).toHaveValue('');
  });

  it('removes a saved key through Rust', async () => {
    ipc.getTranslationSnapshot.mockResolvedValue(snapshot({ hasKey: true }));
    ipc.translationClearKey.mockResolvedValue({ status: 'ok', data: snapshot({ hasKey: false }) });
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await flush();
    expect(ipc.translationClearKey).toHaveBeenCalledTimes(1);
    expect(keyField()).toBeInTheDocument();
  });

  it('changes the default pair from an inline list', async () => {
    renderPane();
    await flush();
    const change = screen.getAllByRole('button', { name: 'Change' });
    expect(change).toHaveLength(2);
    const [, targetChange] = change;
    if (targetChange === undefined) throw new Error('no target row');
    fireEvent.click(targetChange);
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search languages' }), {
      target: { value: 'jap' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Japanese' }));
    await flush();
    expect(saved().target).toBe('ja');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByText('Japanese')).toBeInTheDocument();
  });
});
