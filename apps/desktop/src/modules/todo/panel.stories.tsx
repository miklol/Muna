import type { Task, TodoCommand, TodoSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { task, todoSnapshot, todayAt } from '../../storybook/samples';
import { TodoPanel } from './panel';
import { useTodoStore } from './todo-store';

/**
 * A fake task store: add appends to the list, complete stamps the task, delete moves it to the
 * trash and restore brings it back — each answering with the whole snapshot, as Rust does.
 */
const todoService = (initial: TodoSnapshot): IpcHandlers => {
  let snapshot = initial;
  const now = () => Date.now();
  const edit = (recipe: (tasks: Task[]) => Task[]): TodoSnapshot => {
    snapshot = { ...snapshot, tasks: recipe(snapshot.tasks) };
    return snapshot;
  };
  return {
    // Each mount reads the snapshot first, which re-seeds the fake for the next story.
    get_todo_snapshot: () => {
      snapshot = initial;
      return snapshot;
    },
    todo_command: (args) => {
      const { command } = args as { command: TodoCommand };
      switch (command.kind) {
        case 'add':
          return edit((tasks) => [
            ...tasks,
            task({
              id: `story-${String(tasks.length + 1)}`,
              listId: command.listId,
              title: command.title,
              sortOrder: tasks.length,
              createdAtMs: now(),
              updatedAtMs: now(),
            }),
          ]);
        case 'complete':
          return edit((tasks) =>
            tasks.map((item) =>
              item.id === command.id
                ? { ...item, completedAtMs: command.completed ? now() : null, updatedAtMs: now() }
                : item,
            ),
          );
        case 'delete':
          return edit((tasks) =>
            tasks.map((item) =>
              item.id === command.id ? { ...item, deletedAtMs: now(), updatedAtMs: now() } : item,
            ),
          );
        case 'restore':
          return edit((tasks) =>
            tasks.map((item) =>
              item.id === command.id ? { ...item, deletedAtMs: null, updatedAtMs: now() } : item,
            ),
          );
        case 'purge':
          return edit((tasks) => tasks.filter((item) => item.id !== command.id));
        case 'emptyTrash':
          return edit((tasks) => tasks.filter((item) => item.deletedAtMs === null));
        default:
          return snapshot;
      }
    },
  };
};

const meta = {
  title: 'Modules/Tasks/Panel',
  component: TodoPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: todoService(todoSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Tasks">
      <TodoPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useTodoStore.setState({ snapshot: null, receivedAt: 0, quickAddPending: false });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof TodoPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The inbox: two open tasks with their due labels, one done, the add field on top. */
export const Default: Story = {};

/** Typing a task and pressing Enter adds it to the list. */
export const AddsATask: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = await canvas.findByRole('textbox', { name: 'Add a task' });
    await userEvent.type(field, 'Water the plants{Enter}');
    await waitFor(async () => {
      await expect(canvas.getByText('Water the plants')).toBeVisible();
    });
  },
};

/** Ticking a task moves it below the open ones with a strike. */
export const Completes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('checkbox', { name: 'Review the release notes' }),
    );
    await waitFor(async () => {
      await expect(
        canvas.getByRole('checkbox', { name: 'Review the release notes' }),
      ).toBeChecked();
    });
  },
};

/** An overdue task: due this morning and still open, the label says so. */
export const Overdue: Story = {
  parameters: {
    ipc: todoService(
      todoSnapshot({
        tasks: [
          task({ id: 'call', title: 'Call the bank', dueMs: todayAt(8, 30) }),
          task({ id: 'later', title: 'Book the train', sortOrder: 1 }),
        ],
      }),
    ),
  } satisfies MunaStoryParameters,
};

/** Nothing to do: the empty inbox says how to add a task. */
export const Empty: Story = {
  parameters: {
    ipc: todoService(todoSnapshot({ tasks: [] })),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale: the add field, checkboxes and due labels flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
