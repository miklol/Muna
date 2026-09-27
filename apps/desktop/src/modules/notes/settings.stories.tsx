import type { NotesSnapshot } from '@muna/contracts';
import { writeNotesSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { useNotesStore } from './notes-store';
import { NotesSettingsPane } from './settings';

const DEFAULT_FOLDER = 'C:\\Users\\sam\\AppData\\Roaming\\Muna\\notes';

const snapshot = (overrides: Partial<NotesSnapshot> = {}): NotesSnapshot => ({
  folder: DEFAULT_FOLDER,
  defaultFolder: true,
  notes: [],
  inboxId: null,
  problem: null,
  ...overrides,
});

/** A fake notes service for the pane: the picker always answers with an Obsidian vault. */
const notesService = (initial: NotesSnapshot): IpcHandlers => ({
  get_notes_snapshot: () => initial,
  notes_pick_folder: () => 'D:\\Obsidian\\Vault',
  notes_reveal_folder: () => null,
});

const meta = {
  title: 'Modules/Notes/Settings pane',
  component: NotesSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: notesService(snapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="notes.title">
      <NotesSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useNotesStore.setState({ snapshot: null, receivedAt: 0, quickNotePending: false });
  },
} satisfies Meta<typeof NotesSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The default folder under the profile, with *Change* and *Open folder*. */
export const Default: Story = {};

/** A chosen folder — an Obsidian vault — with the way back to the default. */
export const ChosenFolder: Story = {
  parameters: {
    ipc: notesService(snapshot({ folder: 'D:\\Obsidian\\Vault', defaultFolder: false })),
    settings: (base) => writeNotesSettings(base, { folder: 'D:\\Obsidian\\Vault' }),
  } satisfies MunaStoryParameters,
};

/** The chosen folder is on a drive that is not plugged in. */
export const FolderMissing: Story = {
  parameters: {
    ipc: notesService(snapshot({ folder: 'E:\\Vault', defaultFolder: false, problem: 'missing' })),
    settings: (base) => writeNotesSettings(base, { folder: 'E:\\Vault' }),
  } satisfies MunaStoryParameters,
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};
