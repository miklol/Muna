import type { Task, TodoSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useTodoStore } from './todo-store';
import { TodoWidget, upcomingTasks, WIDGET_ROWS } from './widget';

const ipc = vi.hoisted(() => ({
  getTodoSnapshot: vi.fn(() => new Promise<never>(() => undefined)),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { getTodoSnapshot: ipc.getTodoSnapshot },
  events: { todoChanged: { listen: ipc.listen } },
}));

/** A Tuesday at 13:30 local time. */
const now = new Date(2026, 2, 10, 13, 30).getTime();
const HOUR = 3_600_000;

const task = (overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
  listId: 'inbox',
  notes: '',
  dueMs: null,
  allDay: false,
  completedAtMs: null,
  deletedAtMs: null,
  sortOrder: 0,
  createdAtMs: now - HOUR,
  updatedAtMs: now - HOUR,
  ...overrides,
});

const snapshot = (tasks: Task[]): TodoSnapshot => ({
  lists: [{ id: 'inbox', name: null, sortOrder: 0 }],
  tasks,
  retentionDays: 30,
});

const renderWidget = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <TodoWidget span={1} />
    </I18nextProvider>,
  );

describe('upcomingTasks', () => {
  it('lists open tasks soonest due first, undated ones after in stored order', () => {
    const tasks = [
      task({ id: 'later', title: 'Later', dueMs: now + 3 * HOUR, sortOrder: 0 }),
      task({ id: 'undated-b', title: 'B', sortOrder: 2 }),
      task({ id: 'done', title: 'Done', dueMs: now - HOUR, completedAtMs: now }),
      task({ id: 'soon', title: 'Soon', dueMs: now + HOUR, sortOrder: 5 }),
      task({ id: 'trash', title: 'Trash', deletedAtMs: now }),
      task({ id: 'undated-a', title: 'A', sortOrder: 1 }),
    ];
    expect(upcomingTasks(tasks).map((entry) => entry.id)).toEqual([
      'soon',
      'later',
      'undated-a',
      'undated-b',
    ]);
  });
});

describe('TodoWidget', () => {
  beforeEach(() => {
    useTodoStore.setState({ snapshot: null, receivedAt: 0 });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing before the first snapshot and says so once it is empty', () => {
    const { container } = renderWidget();
    expect(container).toBeEmptyDOMElement();
    act(() => {
      useTodoStore.getState().setSnapshot(snapshot([]), now);
    });
    expect(screen.getByText('Nothing open')).toBeInTheDocument();
  });

  it('shows three tasks with their due labels, overdue in red, and counts the rest', () => {
    useTodoStore
      .getState()
      .setSnapshot(
        snapshot([
          task({ id: 'a', title: 'Call the bank', dueMs: now - HOUR }),
          task({ id: 'b', title: 'Review the release notes', dueMs: now + 2 * HOUR }),
          task({ id: 'c', title: 'Water the plants', dueMs: now + 24 * HOUR, allDay: true }),
          task({ id: 'd', title: 'Someday' }),
          task({ id: 'e', title: 'Another day' }),
        ]),
        now,
      );
    renderWidget();
    const rows = within(screen.getByRole('list', { name: 'Tasks' })).getAllByRole('listitem');
    expect(rows).toHaveLength(WIDGET_ROWS);
    expect(rows[0]).toHaveTextContent('Call the bank');
    expect(rows[0]).toHaveTextContent('Today, 12:30 PM');
    expect(rows[0]).toHaveAttribute('data-overdue', 'true');
    expect(rows[0]).toHaveTextContent('overdue');
    expect(rows[1]).toHaveTextContent('Today, 3:30 PM');
    expect(rows[1]).not.toHaveAttribute('data-overdue');
    expect(rows[2]).toHaveTextContent('Tomorrow');
    expect(screen.getByText('2 more')).toBeInTheDocument();
  });
});
