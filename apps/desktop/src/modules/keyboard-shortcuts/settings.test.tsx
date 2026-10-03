import type { HotkeyBinding, IpcError, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  readKeyboardShortcutsSettings,
  SHELL_ACTION_IDS,
  writeKeyboardShortcutsSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { KeyboardShortcutsSettingsPane, refusalFrom, stateKey } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getHotkeys: vi.fn<() => Promise<HotkeyBinding[]>>(),
  setHotkey: vi.fn<(action: string, chord: string) => Promise<IpcResult<HotkeyBinding[]>>>(),
  clearHotkey: vi.fn<(action: string) => Promise<IpcResult<HotkeyBinding[]>>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getHotkeys: ipc.getHotkeys,
    setHotkey: ipc.setHotkey,
    clearHotkey: ipc.clearHotkey,
  },
  events: {},
}));

const bindings: HotkeyBinding[] = [
  { action: SHELL_ACTION_IDS.togglePanel, chord: 'ctrl+alt+space', state: 'registered' },
  { action: SHELL_ACTION_IDS.palette, chord: 'ctrl+shift+space', state: 'inUse' },
  { action: SHELL_ACTION_IDS.snooze, chord: 'ctrl+alt+n', state: 'registered' },
];

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

describe('KeyboardShortcutsSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getHotkeys.mockReset().mockResolvedValue(bindings);
    ipc.setHotkey.mockReset();
    ipc.clearHotkey.mockReset();
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
          <KeyboardShortcutsSettingsPane />
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

  const recorder = (action: string) =>
    screen.getByRole('button', { name: `Shortcut for ${action}` });

  it('maps binding states and refusals to what the row says', () => {
    expect(stateKey('registered')).toBeNull();
    expect(stateKey('unbound')).toBeNull();
    expect(stateKey('inUse')).toBe('shortcuts.state.inUse');
    expect(stateKey('invalid')).toBe('shortcuts.state.invalid');

    const taken = refusalFrom({ code: 'hotkey.taken', message: '' }, 'Ctrl+Alt+N', bindings);
    expect(taken).toEqual({ kind: 'taken', by: SHELL_ACTION_IDS.snooze });
    expect(refusalFrom({ code: 'hotkey.inUse', message: '' }, 'ctrl+q', bindings)).toEqual({
      kind: 'inUse',
    });
    expect(refusalFrom({ code: 'hotkey.invalid', message: '' }, 'ctrl+q', bindings)).toEqual({
      kind: 'invalid',
    });
  });

  it('lists the shell actions with their chords and says when the OS refused one', async () => {
    renderPane();
    await flush();
    expect(ipc.getHotkeys).toHaveBeenCalledTimes(1);

    const toggle = recorder('Show or hide the notch');
    expect(within(toggle).getAllByText(/^(Ctrl|Alt|Space)$/)).toHaveLength(3);
    expect(recorder('Next module')).toHaveTextContent('Not set');
    expect(screen.getByText('In use by another app')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shortcut for Open module 9' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shortcut for Add a task' })).toBeInTheDocument();
  });

  it('records a chord on the next keydown and registers before anything is saved', async () => {
    const updated: HotkeyBinding[] = [
      ...bindings,
      { action: SHELL_ACTION_IDS.nextModule, chord: 'ctrl+alt+right', state: 'registered' },
    ];
    ipc.setHotkey.mockResolvedValue({ status: 'ok', data: updated });
    renderPane();
    await flush();

    const next = recorder('Next module');
    fireEvent.click(next);
    expect(next).toHaveTextContent('Press a shortcut');
    // Modifiers alone keep the recorder waiting.
    fireEvent.keyDown(next, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(next).toHaveTextContent('Press a shortcut');
    fireEvent.keyDown(next, {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      altKey: true,
    });
    await flush();

    expect(ipc.setHotkey).toHaveBeenCalledWith(SHELL_ACTION_IDS.nextModule, 'ctrl+alt+right');
    expect(within(recorder('Next module')).getAllByText(/^(Ctrl|Alt|→)$/)).toHaveLength(3);
    expect(ipc.updateSettings).not.toHaveBeenCalled();
  });

  it('keeps the old binding and names the holder when a chord is refused', async () => {
    ipc.setHotkey.mockResolvedValue({
      status: 'error',
      error: { code: 'hotkey.taken', message: 'the shortcut is already bound to shell.snooze' },
    });
    renderPane();
    await flush();

    const toggle = recorder('Show or hide the notch');
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true });
    await flush();

    expect(ipc.setHotkey).toHaveBeenCalledWith(SHELL_ACTION_IDS.togglePanel, 'ctrl+alt+n');
    expect(screen.getByText('Already used by Snooze the notch')).toBeInTheDocument();
    expect(
      within(recorder('Show or hide the notch')).getAllByText(/^(Ctrl|Alt|Space)$/),
    ).toHaveLength(3);

    // A plain letter is refused before Rust is even asked.
    fireEvent.click(recorder('Next module'));
    fireEvent.keyDown(recorder('Next module'), { key: 'a', code: 'KeyA' });
    expect(screen.getByText('Add Ctrl, Alt or Win')).toBeInTheDocument();
    expect(ipc.setHotkey).toHaveBeenCalledTimes(1);
  });

  it('Esc cancels recording, Backspace and the clear button unbind', async () => {
    const cleared = bindings.map((binding) =>
      binding.action === SHELL_ACTION_IDS.togglePanel
        ? { ...binding, chord: null, state: 'unbound' as const }
        : binding,
    );
    ipc.clearHotkey.mockResolvedValue({ status: 'ok', data: cleared });
    renderPane();
    await flush();

    const toggle = recorder('Show or hide the notch');
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: 'Escape', code: 'Escape' });
    expect(ipc.clearHotkey).not.toHaveBeenCalled();
    expect(within(toggle).getAllByText(/^(Ctrl|Alt|Space)$/)).toHaveLength(3);

    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: 'Backspace', code: 'Backspace' });
    await flush();
    expect(ipc.clearHotkey).toHaveBeenCalledWith(SHELL_ACTION_IDS.togglePanel);
    expect(recorder('Show or hide the notch')).toHaveTextContent('Not set');

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear the shortcut for Snooze the notch' }),
    );
    await flush();
    expect(ipc.clearHotkey).toHaveBeenLastCalledWith(SHELL_ACTION_IDS.snooze);
  });

  it('writes the preferences into the keyboard-shortcuts namespace', async () => {
    cacheSettings(
      queryClient,
      writeKeyboardShortcutsSettings(defaultSettings(), {
        ...readKeyboardShortcutsSettings(defaultSettings()),
        snoozeMinutes: 30,
      }),
    );
    renderPane();
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Only while hovering' }));
    await flush();
    const saved = () =>
      readKeyboardShortcutsSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());
    expect(saved().onlyWhileHovering).toBe(true);
    expect(saved().snoozeMinutes).toBe(30);
    expect(saved().bindings).toEqual(readKeyboardShortcutsSettings(defaultSettings()).bindings);

    const snooze = screen.getByRole('radiogroup', { name: 'Snooze for' });
    fireEvent.click(within(snooze).getByRole('radio', { name: '60 min' }));
    await flush();
    expect(saved().snoozeMinutes).toBe(60);
    expect(ipc.updateSettings.mock.lastCall?.[0].general).toEqual(defaultSettings().general);
  });
});
