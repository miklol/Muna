import type { Settings, TodoCommand, TodoSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readTodoSettings, writeTodoSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { TodoSettingsPane } from './settings';
import { useTodoStore } from './todo-store';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getTodoSnapshot: vi.fn<() => Promise<IpcResult<TodoSnapshot>>>(),
  todoCommand: vi.fn<(command: TodoCommand) => Promise<IpcResult<TodoSnapshot>>>(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getTodoSnapshot: ipc.getTodoSnapshot,
    todoCommand: ipc.todoCommand,
  },
  events: {
    todoChanged: { listen: ipc.listen },
  },
}));

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const snapshot = (lists: TodoSnapshot['lists']): IpcResult<TodoSnapshot> => ({
  status: 'ok',
  data: { lists, tasks: [], retentionDays: 30 },
});

describe('TodoSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useTodoStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getTodoSnapshot.mockReset().mockResolvedValue(
      snapshot([
        { id: 'inbox', name: null, sortOrder: 0 },
        { id: 'work', name: 'Work', sortOrder: 1 },
      ]),
    );
    ipc.todoCommand
      .mockReset()
      .mockResolvedValue(snapshot([{ id: 'inbox', name: null, sortOrder: 0 }]));
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
          <TodoSettingsPane />
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

  const saved = () => readTodoSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows retention, the strip toggles and the lists from the document and the snapshot', async () => {
    cacheSettings(
      queryClient,
      writeTodoSettings(defaultSettings(), {
        retentionDays: 7,
        dueNotices: false,
        showDueInStrip: true,
      }),
    );
    renderPane();
    await flush();
    expect(screen.getByRole('slider', { name: 'Keep deleted tasks for' })).toHaveValue('7');
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Show the next due task in the strip' }),
    ).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Announce a task when it is due' }),
    ).not.toBeChecked();
    const lists = screen.getByRole('region', { name: 'Lists' });
    expect(within(lists).getByText('Tasks')).toBeInTheDocument();
    expect(within(lists).getByText('Default')).toBeInTheDocument();
    expect(within(lists).getByText('Work')).toBeInTheDocument();
    expect(within(lists).getByRole('button', { name: 'Delete the Work list' })).toBeInTheDocument();
    expect(within(lists).queryByRole('button', { name: 'Delete the Tasks list' })).toBeNull();
  });

  it('saves the toggles at once', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Announce a task when it is due' }));
    await flush();
    expect(saved().dueNotices).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Show the next due task in the strip' }));
    await flush();
    expect(saved().showDueInStrip).toBe(false);
  });

  it('saves the retention slider on release', async () => {
    renderPane();
    await flush();
    const slider = screen.getByRole('slider', { name: 'Keep deleted tasks for' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    await flush();
    expect(saved().retentionDays).toBe(31);
  });

  it('adds and deletes lists through commands', async () => {
    const inbox = { id: 'inbox', name: null, sortOrder: 0 };
    const work = { id: 'work', name: 'Work', sortOrder: 1 };
    ipc.todoCommand.mockImplementation((command) =>
      Promise.resolve(
        command.kind === 'addList'
          ? snapshot([inbox, work, { id: 'errands', name: command.name, sortOrder: 2 }])
          : snapshot([inbox, { id: 'errands', name: 'Errands', sortOrder: 2 }]),
      ),
    );
    renderPane();
    await flush();
    const field = screen.getByRole('textbox', { name: 'New list' });
    fireEvent.change(field, { target: { value: '  Errands ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(ipc.todoCommand).toHaveBeenCalledWith({ kind: 'addList', name: 'Errands' });
    expect(field).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Delete the Errands list' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete the Work list' }));
    await flush();
    expect(ipc.todoCommand).toHaveBeenLastCalledWith({ kind: 'deleteList', id: 'work' });
    // The reply is the snapshot after the command: Work is gone.
    expect(screen.queryByRole('button', { name: 'Delete the Work list' })).toBeNull();
  });
});
