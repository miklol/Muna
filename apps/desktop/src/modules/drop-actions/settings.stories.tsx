import type { DropActionsSnapshot, DropJob } from '@muna/contracts';
import {
  DROP_MAX_FOLDERS,
  defaultDropActionsSettings,
  writeDropActionsSettings,
} from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { DropActionsSettingsPane } from './settings';

/** A fake `drop_actions` service: nothing running unless a story says so, a picker that answers. */
const dropService = (jobs: readonly DropJob[] = [], picked: string | null = null): IpcHandlers => ({
  get_drop_actions_snapshot: (): DropActionsSnapshot => ({
    settings: defaultDropActionsSettings(),
    jobs: [...jobs],
  }),
  drop_pick_folder: () => picked,
  drop_cancel_job: () => null,
});

const withFolders: MunaStoryParameters['settings'] = (base) =>
  writeDropActionsSettings(base, {
    ...defaultDropActionsSettings(),
    folders: [
      { id: 'onedrive', name: 'OneDrive', path: 'C:\\Users\\me\\OneDrive', mode: 'copy' },
      { id: 'archive', name: 'Archive', path: 'D:\\Archive', mode: 'move' },
    ],
    tiles: [
      { kind: 'folder', id: 'onedrive' },
      { kind: 'folder', id: 'archive' },
      { kind: 'divider' },
      { kind: 'nearbyShare' },
      { kind: 'copyTo' },
      { kind: 'zip' },
      { kind: 'reveal' },
      { kind: 'trash' },
    ],
  });

const meta = {
  title: 'Modules/Drop actions/Settings pane',
  component: DropActionsSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: dropService(),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="dropActions.title">
      <DropActionsSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof DropActionsSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A fresh install: every built-in tile on, no folders, nothing running. */
export const Default: Story = {};

/** Two folders lead the row with a divider; hidden built-ins wait, dimmed, to be turned on. */
export const WithFolders: Story = {
  parameters: { settings: withFolders } satisfies MunaStoryParameters,
};

/** Eight folders: the picker button gives way until one is removed. */
export const FoldersFull: Story = {
  parameters: {
    settings: (base) => {
      const drop = defaultDropActionsSettings();
      const folders = Array.from({ length: DROP_MAX_FOLDERS }, (_, index) => ({
        id: `folder-${String(index)}`,
        name: `Folder ${String(index + 1)}`,
        path: `D:\\Folders\\${String(index + 1)}`,
        mode: 'copy' as const,
      }));
      return writeDropActionsSettings(base, {
        ...drop,
        folders,
        tiles: [
          ...drop.tiles,
          ...folders.map((folder) => ({ kind: 'folder' as const, id: folder.id })),
        ],
      });
    },
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Choose…' })).toBeDisabled();
  },
};

/** Drops turned off: the notch leaves a drag alone; the rest of the pane stays editable. */
export const DropsOff: Story = {
  parameters: {
    settings: (base) => ({
      ...base,
      shell: { ...base.shell, disabledModules: ['drop-actions'] },
    }),
  } satisfies MunaStoryParameters,
};

/** Choosing a folder through the picker adds a copy tile at the end of the row. */
export const AddingAFolder: Story = {
  parameters: { ipc: dropService([], 'C:\\Users\\me\\Pictures\\Screenshots') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Choose…' }));
    await expect(await canvas.findByText('C:\\Users\\me\\Pictures\\Screenshots')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Remove Screenshots' })).toBeVisible();
  },
};

/** A zip in flight, one just done and one that failed. */
export const InProgress: Story = {
  parameters: {
    ipc: dropService([
      { id: 1, action: 'zip', count: 12, state: { kind: 'running', percent: 42 } },
      { id: 2, action: 'unzip', count: 1, state: { kind: 'done' } },
      {
        id: 3,
        action: 'copy',
        count: 3,
        state: { kind: 'failed', reason: 'notFound' },
      },
    ]),
  } satisfies MunaStoryParameters,
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
