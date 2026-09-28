import { defaultTodoSettings, writeTodoSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { todoSnapshot } from '../../storybook/samples';
import { TodoSettingsPane } from './settings';
import { useTodoStore } from './todo-store';

/** A fake task store for the pane: adding a list appends it, deleting one removes it. */
const todoService = (): IpcHandlers => {
  const initial = todoSnapshot();
  let snapshot = initial;
  return {
    // Each mount reads the snapshot first, which re-seeds the fake for the next story.
    get_todo_snapshot: () => {
      snapshot = initial;
      return snapshot;
    },
    todo_command: (args) => {
      const { command } = args as { command: { kind: string; name?: string; id?: string } };
      if (command.kind === 'addList' && command.name !== undefined) {
        snapshot = {
          ...snapshot,
          lists: [
            ...snapshot.lists,
            { id: `story-${String(snapshot.lists.length)}`, name: command.name, sortOrder: 9 },
          ],
        };
      } else if (command.kind === 'deleteList') {
        snapshot = { ...snapshot, lists: snapshot.lists.filter((list) => list.id !== command.id) };
      }
      return snapshot;
    },
  };
};

const meta = {
  title: 'Modules/Tasks/Settings pane',
  component: TodoSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: todoService(),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="todo.title">
      <TodoSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useTodoStore.setState({ snapshot: null, receivedAt: 0, quickAddPending: false });
  },
} satisfies Meta<typeof TodoSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Thirty days of trash, both strip rows on, the inbox and a Work list. */
export const Default: Story = {};

/** Naming a new list and pressing Enter adds it under the others. */
export const AddsAList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'New list' }),
      'Errands{Enter}',
    );
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: 'Delete the Errands list' })).toBeVisible();
    });
  },
};

/** A quieter setup: a week of trash and nothing in the strip. */
export const Quiet: Story = {
  parameters: {
    settings: (base) =>
      writeTodoSettings(base, {
        ...defaultTodoSettings(),
        retentionDays: 7,
        dueNotices: false,
        showDueInStrip: false,
      }),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the slider, switches and the list rows. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
