import type { Task, TaskList, TodoCommand, TodoSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { TodoPanel } from './panel';
import { listTasks, trashedTasks, useTodoStore } from './todo-store';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: TodoSnapshot }>[] = [];
  return {
    getTodoSnapshot: vi.fn<() => Promise<IpcResult<TodoSnapshot>>>(),
    todoCommand: vi.fn<(command: TodoCommand) => Promise<IpcResult<TodoSnapshot>>>(),
    listen: vi.fn((callback: Listener<{ snapshot: TodoSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: TodoSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getTodoSnapshot: ipc.getTodoSnapshot,
    todoCommand: ipc.todoCommand,
  },
  events: {
    todoChanged: { listen: ipc.listen },
  },
}));

/** A Friday at 09:00 local time; tests pin the clock here. */
const NOW = new Date(2026, 8, 25, 9, 0, 0);
const local = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m, d, h, min).getTime();

let nextId = 0;
const task = (overrides: Partial<Task> & { title: string }): Task => ({
  id: `t${String(++nextId)}`,
  listId: 'inbox',
  notes: '',
  dueMs: null,
  allDay: false,
  completedAtMs: null,
  deletedAtMs: null,
  sortOrder: nextId,
  createdAtMs: NOW.getTime() - 60_000,
  updatedAtMs: NOW.getTime() - 60_000,
  ...overrides,
});

const snapshot = (tasks: Task[], lists: TaskList[] = [{ id: 'inbox', name: null, sortOrder: 0 }]) =>
  ({ lists, tasks, retentionDays: 30 }) satisfies TodoSnapshot;

const ok = <T,>(data: T): IpcResult<T> => ({ status: 'ok', data });

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <TodoPanel />
    </I18nextProvider>,
  );

/** Lets the snapshot promise settle and any leaving row finish its exit. */
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

const rowTitles = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.todo-row__title')?.textContent);

describe('todo store helpers', () => {
  it('orders open tasks by sort order, then completed ones latest first', () => {
    const tasks = [
      task({ title: 'b', sortOrder: 2 }),
      task({ title: 'a', sortOrder: 1 }),
      task({ title: 'done early', completedAtMs: 1 }),
      task({ title: 'done late', completedAtMs: 2 }),
      task({ title: 'trashed', deletedAtMs: 3 }),
      task({ title: 'elsewhere', listId: 'work' }),
    ];
    expect(listTasks(tasks, 'inbox').map((t) => t.title)).toEqual([
      'a',
      'b',
      'done late',
      'done early',
    ]);
    expect(trashedTasks(tasks).map((t) => t.title)).toEqual(['trashed']);
  });
});

describe('TodoPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    nextId = 0;
    useTodoStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.getTodoSnapshot.mockReset().mockResolvedValue(ok(snapshot([])));
    ipc.todoCommand.mockReset().mockImplementation(() => Promise.resolve(ok(snapshot([]))));
    ipc.listen.mockClear();
  });

  afterEach(async () => {
    cleanup();
    // Let Motion's frame loop run the frame it scheduled, or the dropped fake frame would leave
    // it waiting forever and the next test's exit animations would never finish.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  it('subscribes once, shows the empty state and unlistens on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.getTodoSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);
    expect(screen.getByText('Type a task above and press Enter')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    view.unmount();
    expect(ipc.listenerCount()).toBe(0);
  });

  it('lists tasks with due labels, overdue in red and spoken', async () => {
    ipc.getTodoSnapshot.mockResolvedValue(
      ok(
        snapshot([
          task({ title: 'Call Sam', dueMs: local(2026, 8, 26, 15), sortOrder: 1 }),
          task({ title: 'Pay rent', dueMs: local(2026, 8, 25, 8), sortOrder: 2 }),
          task({ title: 'Read', sortOrder: 3 }),
          task({ title: 'Water plants', dueMs: local(2026, 8, 25), allDay: true, sortOrder: 4 }),
        ]),
      ),
    );
    renderPanel();
    await flush();
    const list = screen.getByRole('list', { name: 'Tasks' });
    expect(rowTitles(list)).toEqual(['Call Sam', 'Pay rent', 'Read', 'Water plants']);
    const dues = [...list.querySelectorAll('.todo-row__due')];
    expect(dues.map((due) => due.textContent)).toEqual([
      expect.stringMatching(/^Tomorrow, 3:00\sPM$/),
      expect.stringMatching(/^Today, 8:00\sAM, overdue$/),
      'Today',
    ]);
    expect(dues[1]).toHaveAttribute('data-overdue', 'true');
    expect(dues[0]).not.toHaveAttribute('data-overdue');
    expect(dues[2]).not.toHaveAttribute('data-overdue');
  });

  it('holds no timers once the rows have settled', async () => {
    ipc.getTodoSnapshot.mockResolvedValue(
      ok(snapshot([task({ title: 'Call Sam', dueMs: local(2026, 8, 26, 15) })])),
    );
    renderPanel();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText('Call Sam')).toBeInTheDocument();
    // Due labels are derived from the snapshot's arrival time, so no interval keeps them fresh.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('adds a task from the field with the parsed due and clears it', async () => {
    const added = task({ title: 'Call Sam', dueMs: local(2026, 8, 26, 15) });
    ipc.todoCommand.mockResolvedValue(ok(snapshot([added])));
    renderPanel();
    await flush();
    const field = screen.getByRole('textbox', { name: 'Add a task' });
    fireEvent.change(field, { target: { value: 'Call Sam tomorrow 3pm' } });
    expect(screen.getByText(/^Due Tomorrow, 3:00\sPM$/)).toBeInTheDocument();
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(ipc.todoCommand).toHaveBeenCalledWith({
      kind: 'add',
      listId: 'inbox',
      title: 'Call Sam',
      due: { atMs: local(2026, 8, 26, 15), allDay: false },
    });
    expect(field).toHaveValue('');
    expect(rowTitles(screen.getByRole('list', { name: 'Tasks' }))).toEqual(['Call Sam']);
  });

  it('completes and reopens a task through the checkbox', async () => {
    const open = task({ title: 'Read' });
    ipc.getTodoSnapshot.mockResolvedValue(ok(snapshot([open])));
    ipc.todoCommand.mockImplementation((command) =>
      Promise.resolve(
        ok(
          snapshot([
            {
              ...open,
              completedAtMs:
                command.kind === 'complete' && command.completed ? NOW.getTime() : null,
            },
          ]),
        ),
      ),
    );
    renderPanel();
    await flush();
    const box = screen.getByRole('checkbox', { name: 'Read' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await flush();
    expect(ipc.todoCommand).toHaveBeenLastCalledWith({
      kind: 'complete',
      id: open.id,
      completed: true,
    });
    expect(screen.getByRole('checkbox', { name: 'Read' })).toBeChecked();
    expect(screen.getByRole('listitem')).toHaveAttribute('data-done', 'true');
    expect(screen.getByRole('button', { name: 'Clear completed' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read' }));
    await flush();
    expect(ipc.todoCommand).toHaveBeenLastCalledWith({
      kind: 'complete',
      id: open.id,
      completed: false,
    });
  });

  it('moves a task to the trash, lists it there, restores it and empties the trash', async () => {
    const read = task({ title: 'Read' });
    const gone = task({ title: 'Old', deletedAtMs: NOW.getTime() - 1000 });
    ipc.getTodoSnapshot.mockResolvedValue(ok(snapshot([read, gone])));
    ipc.todoCommand.mockImplementation((command) => {
      switch (command.kind) {
        case 'delete':
          return Promise.resolve(ok(snapshot([{ ...read, deletedAtMs: NOW.getTime() }, gone])));
        case 'restore':
          return Promise.resolve(
            ok(
              snapshot([
                { ...read, deletedAtMs: NOW.getTime() },
                { ...gone, deletedAtMs: null },
              ]),
            ),
          );
        case 'emptyTrash':
          return Promise.resolve(ok(snapshot([{ ...gone, deletedAtMs: null }])));
        default:
          return Promise.resolve(ok(snapshot([read, gone])));
      }
    });
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Move Read to trash' }));
    await flush();
    expect(ipc.todoCommand).toHaveBeenLastCalledWith({ kind: 'delete', id: read.id });
    expect(screen.getByText('Type a task above and press Enter')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Trash', pressed: false });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Trash', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trash' })).toBeInTheDocument();
    expect(screen.getByText('Deleted tasks are removed after 30 days')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // Latest deletion first.
    expect(rowTitles(screen.getByRole('list', { name: 'Trash' }))).toEqual(['Read', 'Old']);

    fireEvent.click(screen.getByRole('button', { name: 'Restore Old' }));
    await flush();
    expect(ipc.todoCommand).toHaveBeenLastCalledWith({ kind: 'restore', id: gone.id });
    expect(rowTitles(screen.getByRole('list', { name: 'Trash' }))).toEqual(['Read']);

    fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    await flush();
    expect(ipc.todoCommand).toHaveBeenLastCalledWith({ kind: 'emptyTrash' });
    expect(screen.getByText('Nothing in the trash')).toBeInTheDocument();
  });

  it('shows the lists as segments and adds to the chosen one', async () => {
    const lists = [
      { id: 'inbox', name: null, sortOrder: 0 },
      { id: 'work', name: 'Work', sortOrder: 1 },
    ];
    ipc.getTodoSnapshot.mockResolvedValue(
      ok(
        snapshot(
          [task({ title: 'Home thing' }), task({ title: 'Work thing', listId: 'work' })],
          lists,
        ),
      ),
    );
    renderPanel();
    await flush();
    const segments = screen.getByRole('radiogroup', { name: 'List' });
    expect(within(segments).getByRole('radio', { name: 'Tasks' })).toBeChecked();
    expect(rowTitles(screen.getByRole('list', { name: 'Tasks' }))).toEqual(['Home thing']);
    fireEvent.click(within(segments).getByRole('radio', { name: 'Work' }));
    await flush();
    expect(rowTitles(screen.getByRole('list', { name: 'Tasks' }))).toEqual(['Work thing']);
    const field = screen.getByRole('textbox', { name: 'Add a task' });
    fireEvent.change(field, { target: { value: 'Send invoice' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(ipc.todoCommand).toHaveBeenCalledWith({
      kind: 'add',
      listId: 'work',
      title: 'Send invoice',
      due: null,
    });
  });

  it('follows TodoChanged events', async () => {
    renderPanel();
    await flush();
    act(() => {
      ipc.emit(snapshot([task({ title: 'From elsewhere' })]));
    });
    expect(rowTitles(screen.getByRole('list', { name: 'Tasks' }))).toEqual(['From elsewhere']);
  });
});
