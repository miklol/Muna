import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  type IpcError,
  readTranslationSettings,
  type Settings,
  type TranslateRequest,
  type TranslationChunk,
  type TranslationSnapshot,
  writeTranslationSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey } from '../../lib/settings';
import { charCount, TranslationPanel } from './panel';
import { idleResult, useTranslationStore } from './translation-store';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };
type Listener<T> = (event: { payload: T }) => void;

const ipc = vi.hoisted(() => {
  const chunkListeners: Listener<{ chunk: TranslationChunk }>[] = [];
  const changedListeners: Listener<{ snapshot: TranslationSnapshot }>[] = [];
  return {
    getTranslationSnapshot: vi.fn<() => Promise<TranslationSnapshot>>(),
    translate: vi.fn<(request: TranslateRequest) => Promise<IpcResult<number>>>(),
    translationCancel: vi.fn<(requestId: number) => Promise<void>>(),
    translationCopy: vi.fn<(text: string) => Promise<IpcResult<null>>>(),
    openSettings: vi.fn<() => Promise<void>>(),
    updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
    listenChunk: vi.fn((callback: Listener<{ chunk: TranslationChunk }>) => {
      chunkListeners.push(callback);
      return Promise.resolve(() => {
        chunkListeners.splice(chunkListeners.indexOf(callback), 1);
      });
    }),
    listenChanged: vi.fn((callback: Listener<{ snapshot: TranslationSnapshot }>) => {
      changedListeners.push(callback);
      return Promise.resolve(() => {
        changedListeners.splice(changedListeners.indexOf(callback), 1);
      });
    }),
    chunk: (chunk: TranslationChunk) => {
      for (const listener of [...chunkListeners]) listener({ payload: { chunk } });
    },
    changed: (snapshot: TranslationSnapshot) => {
      for (const listener of [...changedListeners]) listener({ payload: { snapshot } });
    },
    chunkListenerCount: () => chunkListeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getTranslationSnapshot: ipc.getTranslationSnapshot,
    translate: ipc.translate,
    translationCancel: ipc.translationCancel,
    translationCopy: ipc.translationCopy,
    openSettings: ipc.openSettings,
    updateSettings: ipc.updateSettings,
  },
  events: {
    translationChunkEvent: { listen: ipc.listenChunk },
    translationChanged: { listen: ipc.listenChanged },
  },
}));

const queryClient = createQueryClient();
queryClient.setQueryDefaults(settingsQueryKey, { gcTime: Number.POSITIVE_INFINITY });

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

const enabled = (overrides: Partial<Contracts.TranslationSettings> = {}): Settings =>
  writeTranslationSettings(defaultSettings(), {
    enabled: true,
    provider: 'openai',
    endpoint: '',
    model: '',
    source: 'auto',
    target: 'en',
    ...overrides,
  });

const snapshot = (overrides: Partial<TranslationSnapshot> = {}): TranslationSnapshot => ({
  enabled: true,
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  hasKey: true,
  needsKey: true,
  active: 0,
  ...overrides,
});

const piece = (requestId: number, text: string): TranslationChunk => ({
  requestId,
  text,
  done: false,
  error: null,
});

const last = (requestId: number, error: TranslationChunk['error'] = null): TranslationChunk => ({
  requestId,
  text: '',
  done: true,
  error,
});

const renderPanel = (settings: Settings = enabled()) => {
  cacheSettings(queryClient, settings);
  return render(
    <Providers>
      <TranslationPanel />
    </Providers>,
  );
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });

const saved = () =>
  readTranslationSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

const source = () => screen.getByLabelText('Text to translate');
const output = () => screen.getByRole('region', { name: 'Translation' });
const note = () => screen.getByRole('status');
const translateButton = () => screen.getByRole('button', { name: 'Translate' });

const type = (text: string) => {
  fireEvent.change(source(), { target: { value: text } });
};

describe('charCount', () => {
  it('counts code points, like the Rust bound', () => {
    expect(charCount('')).toBe(0);
    expect(charCount('héllo')).toBe(5);
    expect(charCount('😀😀')).toBe(2);
  });
});

describe('TranslationPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    useTranslationStore.setState({
      snapshot: null,
      draft: '',
      result: idleResult(),
      focusRequested: false,
    });
    ipc.getTranslationSnapshot.mockReset().mockResolvedValue(snapshot());
    ipc.translate.mockReset().mockResolvedValue({ status: 'ok', data: 1 });
    ipc.translationCancel.mockReset().mockResolvedValue(undefined);
    ipc.translationCopy.mockReset().mockResolvedValue({ status: 'ok', data: null });
    ipc.openSettings.mockReset().mockResolvedValue(undefined);
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says the module is off and points at Settings, sending nothing', async () => {
    renderPanel(defaultSettings());
    await flush();
    expect(screen.getByText('Translation is off')).toBeInTheDocument();
    expect(screen.queryByLabelText('Text to translate')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
    expect(ipc.translate).not.toHaveBeenCalled();
  });

  it('shows the pair, an empty output and the consent line naming the host', async () => {
    renderPanel();
    await flush();
    expect(
      screen.getByRole('button', { name: 'Translate from: Detect language' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Translate to: English' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swap languages' })).toBeDisabled();
    expect(output()).toHaveTextContent('The translation appears here');
    expect(note()).toHaveTextContent('Text goes to api.openai.com');
    expect(translateButton()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Copy translation' })).not.toBeInTheDocument();
  });

  it('streams the chunks for the answered id into the output, then offers Copy', async () => {
    renderPanel(enabled({ source: 'fr', target: 'de' }));
    await flush();
    type('  Bonjour le monde ');
    expect(translateButton()).toBeEnabled();
    fireEvent.click(translateButton());
    await flush();
    expect(ipc.translate).toHaveBeenCalledWith({
      text: 'Bonjour le monde',
      source: 'fr',
      target: 'de',
    });
    expect(note()).toHaveTextContent('Translating');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(output()).toHaveAttribute('aria-busy', 'true');

    act(() => {
      ipc.chunk(piece(1, 'Hallo'));
      ipc.chunk(piece(1, ' Welt'));
      ipc.chunk(piece(7, ' (someone else)'));
    });
    expect(output()).toHaveTextContent('Hallo Welt');
    expect(output()).not.toHaveTextContent('someone else');

    act(() => {
      ipc.chunk(last(1));
    });
    expect(output()).not.toHaveAttribute('aria-busy');
    expect(note()).toHaveTextContent('Translation finished');
    expect(translateButton()).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Copy translation' }));
    await flush();
    expect(ipc.translationCopy).toHaveBeenCalledWith('Hallo Welt');
    expect(note()).toHaveTextContent('Copied');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(note()).toHaveTextContent('Translation finished');
  });

  it('adopts chunks that arrive before the id does and drops the rest', async () => {
    let answer: ((result: IpcResult<number>) => void) | null = null;
    ipc.translate.mockImplementation(
      () =>
        new Promise<IpcResult<number>>((resolve) => {
          answer = resolve;
        }),
    );
    renderPanel();
    await flush();
    type('Hello');
    fireEvent.click(translateButton());
    await flush();

    act(() => {
      ipc.chunk(piece(3, 'Ho'));
      ipc.chunk(piece(9, 'stale'));
      ipc.chunk(piece(3, 'la'));
    });
    expect(output()).toHaveTextContent('Translating');

    await act(async () => {
      answer?.({ status: 'ok', data: 3 });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(output()).toHaveTextContent('Hola');
    expect(output()).not.toHaveTextContent('stale');

    act(() => {
      ipc.chunk(last(3));
    });
    expect(note()).toHaveTextContent('Translation finished');
  });

  it('Ctrl+Enter translates from the source box', async () => {
    renderPanel();
    await flush();
    type('Hello');
    fireEvent.keyDown(source(), { key: 'Enter', ctrlKey: true });
    await flush();
    expect(ipc.translate).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(source(), { key: 'Enter' });
    await flush();
    expect(ipc.translate).toHaveBeenCalledTimes(1);
  });

  it('explains a refused request in one line without any chunk', async () => {
    ipc.translate.mockResolvedValue({
      status: 'error',
      error: { code: 'translation.unauthorized', message: 'refused' },
    });
    renderPanel();
    await flush();
    type('Hello');
    fireEvent.click(translateButton());
    await flush();
    expect(note()).toHaveTextContent('api.openai.com refused the API key. Check it in Settings.');
    expect(translateButton()).toBeEnabled();
    expect(output()).toHaveTextContent('The translation appears here');
  });

  it('keeps partial output and names the failure when a stream ends badly', async () => {
    renderPanel();
    await flush();
    type('Hello');
    fireEvent.click(translateButton());
    await flush();
    act(() => {
      ipc.chunk(piece(1, 'Hal'));
      ipc.chunk(last(1, 'provider'));
    });
    expect(output()).toHaveTextContent('Hal');
    expect(note()).toHaveTextContent('api.openai.com did not answer with a translation.');
  });

  it('Stop cancels through Rust and clears the partial output', async () => {
    renderPanel();
    await flush();
    type('Hello');
    fireEvent.click(translateButton());
    await flush();
    act(() => {
      ipc.chunk(piece(1, 'Hal'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await flush();
    expect(ipc.translationCancel).toHaveBeenCalledWith(1);
    expect(output()).toHaveTextContent('The translation appears here');
    expect(note()).toHaveTextContent('Text goes to api.openai.com');
    // A late chunk for the cancelled request changes nothing.
    act(() => {
      ipc.chunk(piece(1, 'lo'));
    });
    expect(output()).not.toHaveTextContent('lo');
  });

  it('changing a language mid-stream cancels the request and saves the pair', async () => {
    renderPanel();
    await flush();
    type('Hello');
    fireEvent.click(translateButton());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Translate to: English' }));
    expect(screen.getByRole('heading', { name: 'Translate to' })).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: 'Search languages' }),
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search languages' }), {
      target: { value: 'span' },
    });
    expect(screen.getByRole('button', { name: 'Spanish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'German' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Spanish' }));
    await flush();

    expect(ipc.translationCancel).toHaveBeenCalledWith(1);
    expect(saved().target).toBe('es');
    expect(screen.getByRole('button', { name: 'Translate to: Spanish' })).toBeInTheDocument();
    expect(translateButton()).toBeEnabled();
  });

  it('offers Detect language on the source side only and marks the current choice', async () => {
    renderPanel(enabled({ source: 'fr', target: 'en' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Translate from: French' }));
    expect(screen.getByRole('button', { name: 'Detect language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'French' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Translate to: English' }));
    expect(screen.queryByRole('button', { name: 'Detect language' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-current', 'true');
  });

  it('swaps the pair and carries a finished translation back into the source box', async () => {
    renderPanel(enabled({ source: 'fr', target: 'de' }));
    await flush();
    type('Bonjour');
    fireEvent.click(translateButton());
    await flush();
    act(() => {
      ipc.chunk(piece(1, 'Hallo'));
      ipc.chunk(last(1));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Swap languages' }));
    await flush();
    expect(saved()).toMatchObject({ source: 'de', target: 'fr' });
    expect(source()).toHaveValue('Hallo');
    expect(output()).toHaveTextContent('The translation appears here');
  });

  it('refuses text over the bound before sending it', async () => {
    renderPanel();
    await flush();
    type('x'.repeat(5001));
    expect(translateButton()).toBeDisabled();
    expect(note()).toHaveTextContent('Up to 5,000 characters at a time');
    expect(ipc.translate).not.toHaveBeenCalled();
  });

  it('asks for a key first when the provider needs one and none is saved', async () => {
    ipc.getTranslationSnapshot.mockResolvedValue(snapshot({ hasKey: false }));
    renderPanel();
    await flush();
    type('Hello');
    expect(translateButton()).toBeDisabled();
    expect(note()).toHaveTextContent('Add an API key in Settings first');
    act(() => {
      ipc.changed(snapshot({ hasKey: true }));
    });
    expect(translateButton()).toBeEnabled();
    expect(note()).toHaveTextContent('Text goes to api.openai.com');
  });

  it('cancels a running request and unlistens when the panel unmounts, keeping the draft', async () => {
    const view = renderPanel();
    await flush();
    type('Hello');
    fireEvent.click(translateButton());
    await flush();
    act(() => {
      ipc.chunk(piece(1, 'Hal'));
    });
    expect(ipc.chunkListenerCount()).toBe(1);
    view.unmount();
    expect(ipc.translationCancel).toHaveBeenCalledWith(1);
    expect(ipc.chunkListenerCount()).toBe(0);
    expect(useTranslationStore.getState().draft).toBe('Hello');
    expect(useTranslationStore.getState().result).toEqual(idleResult());
  });

  it('puts the caret in the source box when the Translate text action asked for it', async () => {
    useTranslationStore.getState().requestFocus();
    renderPanel();
    await flush();
    expect(document.activeElement).toBe(source());
    expect(useTranslationStore.getState().focusRequested).toBe(false);
  });
});
