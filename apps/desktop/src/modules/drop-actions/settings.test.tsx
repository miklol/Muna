import type { DropActionsSnapshot, DropJob, IpcError, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  DEFAULT_DROP_TILES,
  DROP_MAX_FOLDERS,
  defaultDropActionsSettings,
  defaultSettings,
  readDropActionsSettings,
  writeDropActionsSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import {
  addFolder,
  DROP_ACTIONS_MODULE_ID,
  DropActionsSettingsPane,
  hiddenBuiltIns,
  removeFolder,
  setFolderMode,
  setTileShown,
} from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };
type Listener = (event: { payload: { snapshot: DropActionsSnapshot } }) => void;

const ipc = vi.hoisted(() => {
  const listeners = new Set<Listener>();
  return {
    listeners,
    updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
    getSettings: vi.fn<() => Promise<Settings>>(),
    getDropActionsSnapshot: vi.fn<() => Promise<DropActionsSnapshot>>(),
    dropPickFolder: vi.fn<(title: string) => Promise<IpcResult<string | null>>>(),
    dropCancelJob: vi.fn<(id: number) => Promise<IpcResult<null>>>(),
    dropActionsChanged: {
      listen: vi.fn((listener: Listener) => {
        listeners.add(listener);
        return Promise.resolve(() => {
          listeners.delete(listener);
        });
      }),
    },
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getDropActionsSnapshot: ipc.getDropActionsSnapshot,
    dropPickFolder: ipc.dropPickFolder,
    dropCancelJob: ipc.dropCancelJob,
  },
  events: { dropActionsChanged: ipc.dropActionsChanged },
}));

const snapshot = (jobs: DropJob[]): DropActionsSnapshot => ({
  settings: defaultDropActionsSettings(),
  jobs,
});

const folder = (id: string, mode: 'copy' | 'move' = 'copy') => ({
  id,
  name: id.toUpperCase(),
  path: `C:\\Users\\me\\${id}`,
  mode,
});

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

describe('drop actions settings helpers', () => {
  const base = defaultDropActionsSettings();

  it('lists the built-in tiles the row does not show, in default order', () => {
    expect(hiddenBuiltIns(base)).toEqual([]);
    const trimmed = {
      ...base,
      tiles: [{ kind: 'zip' as const }, { kind: 'nearbyShare' as const }],
    };
    expect(hiddenBuiltIns(trimmed).map((tile) => tile.kind)).toEqual([
      'copyTo',
      'moveTo',
      'openWith',
      'unzip',
      'reveal',
      'trash',
      'eject',
    ]);
  });

  it('hides a tile by removing it and shows it again at the end of the row', () => {
    const hidden = setTileShown(base, { kind: 'zip' }, false);
    expect(hidden.tiles.some((tile) => tile.kind === 'zip')).toBe(false);
    expect(hidden.tiles).toHaveLength(DEFAULT_DROP_TILES.length - 1);
    const shown = setTileShown(hidden, { kind: 'zip' }, true);
    expect(shown.tiles.at(-1)).toEqual({ kind: 'zip' });
    // Showing a shown tile moves it to the end rather than doubling it.
    expect(setTileShown(base, { kind: 'nearbyShare' }, true).tiles).toHaveLength(
      DEFAULT_DROP_TILES.length,
    );
  });

  it('adds a picked folder as a copy tile named after its last segment, once, up to the cap', () => {
    const added = addFolder(base, 'C:\\Users\\me\\OneDrive', 'f1');
    expect(added.folders).toEqual([
      { id: 'f1', name: 'OneDrive', path: 'C:\\Users\\me\\OneDrive', mode: 'copy' },
    ]);
    expect(added.tiles.at(-1)).toEqual({ kind: 'folder', id: 'f1' });
    expect(addFolder(added, 'c:\\users\\me\\onedrive', 'f2')).toBe(added);
    let full = base;
    for (let index = 0; index < DROP_MAX_FOLDERS; index += 1) {
      full = addFolder(full, `D:\\f${String(index)}`, `f${String(index)}`);
    }
    expect(full.folders).toHaveLength(DROP_MAX_FOLDERS);
    expect(addFolder(full, 'D:\\one-more', 'extra')).toBe(full);
  });

  it('removes a folder with its tile and changes a folder mode in place', () => {
    const two = addFolder(addFolder(base, 'D:\\a', 'a'), 'D:\\b', 'b');
    const moved = setFolderMode(two, 'b', 'move');
    expect(moved.folders.map((entry) => entry.mode)).toEqual(['copy', 'move']);
    const removed = removeFolder(moved, 'a');
    expect(removed.folders.map((entry) => entry.id)).toEqual(['b']);
    expect(removed.tiles.filter((tile) => tile.kind === 'folder')).toEqual([
      { kind: 'folder', id: 'b' },
    ]);
  });
});

describe('DropActionsSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    ipc.listeners.clear();
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getDropActionsSnapshot.mockReset().mockResolvedValue(snapshot([]));
    ipc.dropPickFolder.mockReset();
    ipc.dropCancelJob.mockReset().mockResolvedValue({ status: 'ok', data: null });
    ipc.dropActionsChanged.listen.mockClear();
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
          <DropActionsSettingsPane />
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

  const lastSaved = (): Settings => {
    const call = ipc.updateSettings.mock.lastCall;
    if (call === undefined) {
      throw new Error('nothing was saved');
    }
    return call[0];
  };
  const lastDrop = () => readDropActionsSettings(lastSaved());

  it('lists the tiles in order with show toggles and ▲▼, and turns hidden ones back on', async () => {
    const base = defaultSettings();
    cacheSettings(
      queryClient,
      writeDropActionsSettings(base, {
        ...defaultDropActionsSettings(),
        tiles: [{ kind: 'nearbyShare' }, { kind: 'divider' }, { kind: 'zip' }],
      }),
    );
    renderPane();
    await flush();

    const shown = screen.getAllByRole('switch', { name: /^Show (?!actions when)/ });
    expect(shown.map((toggle) => toggle.getAttribute('aria-label'))).toEqual([
      'Show Nearby Share',
      'Show Zip',
      'Show Copy to',
      'Show Move to',
      'Show Open with',
      'Show Unzip',
      'Show Show in Explorer',
      'Show Recycle Bin',
      'Show Eject',
    ]);
    expect(shown[0]).toBeChecked();
    expect(shown[2]).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Move Nearby Share up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Zip down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Divider' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Show Zip' }));
    await flush();
    expect(lastDrop().tiles).toEqual([{ kind: 'nearbyShare' }, { kind: 'divider' }]);

    fireEvent.click(screen.getByRole('switch', { name: 'Show Eject' }));
    await flush();
    expect(lastDrop().tiles.at(-1)).toEqual({ kind: 'eject' });

    fireEvent.click(screen.getByRole('button', { name: 'Move Eject up' }));
    await flush();
    expect(lastDrop().tiles).toEqual([
      { kind: 'nearbyShare' },
      { kind: 'eject' },
      { kind: 'divider' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Divider' }));
    await flush();
    expect(lastDrop().tiles).toEqual([{ kind: 'nearbyShare' }, { kind: 'eject' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await flush();
    expect(lastDrop().tiles).toEqual([
      { kind: 'nearbyShare' },
      { kind: 'eject' },
      { kind: 'divider' },
    ]);
  });

  it('turns drops off through the shell module list and widens the row', async () => {
    renderPane();
    await flush();
    const enabled = screen.getByRole('switch', {
      name: 'Show actions when files are dragged over the notch',
    });
    expect(enabled).toBeChecked();
    fireEvent.click(enabled);
    await flush();
    expect(lastSaved().shell.disabledModules).toEqual([DROP_ACTIONS_MODULE_ID]);

    fireEvent.click(screen.getByRole('switch', { name: 'Expand notch' }));
    await flush();
    expect(lastDrop().expandNotch).toBe(true);
  });

  it('adds a folder through the picker, switches its mode and removes it', async () => {
    ipc.dropPickFolder.mockResolvedValue({ status: 'ok', data: 'C:\\Users\\me\\OneDrive' });
    renderPane();
    await flush();
    expect(
      screen.getByText('No folders yet. Add one to copy or move files into it with a single drop.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    await flush();
    expect(ipc.dropPickFolder).toHaveBeenCalledWith('Choose a folder for dropped files');
    const [saved] = lastDrop().folders;
    expect(saved).toMatchObject({
      name: 'OneDrive',
      path: 'C:\\Users\\me\\OneDrive',
      mode: 'copy',
    });
    expect(lastDrop().tiles.at(-1)).toEqual({ kind: 'folder', id: saved?.id });
    expect(screen.getByText('C:\\Users\\me\\OneDrive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move OneDrive down' })).toBeDisabled();

    const mode = screen.getByRole('radiogroup', {
      name: 'What a drop does with the files in OneDrive',
    });
    fireEvent.click(within(mode).getByRole('radio', { name: 'Move' }));
    await flush();
    expect(lastDrop().folders[0]?.mode).toBe('move');
    expect(screen.getAllByText('Move here')).not.toHaveLength(0);

    // A cancelled picker changes nothing.
    ipc.dropPickFolder.mockResolvedValue({ status: 'ok', data: null });
    const before = ipc.updateSettings.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    await flush();
    expect(ipc.updateSettings.mock.calls.length).toBe(before);

    fireEvent.click(screen.getByRole('button', { name: 'Remove OneDrive' }));
    await flush();
    expect(lastDrop().folders).toEqual([]);
    expect(lastDrop().tiles.some((tile) => tile.kind === 'folder')).toBe(false);
  });

  it('stops offering the picker once the folders are full', async () => {
    const full = defaultDropActionsSettings();
    const folders = Array.from({ length: DROP_MAX_FOLDERS }, (_, index) =>
      folder(`f${String(index)}`),
    );
    cacheSettings(
      queryClient,
      writeDropActionsSettings(defaultSettings(), {
        ...full,
        folders,
        tiles: [
          ...full.tiles,
          ...folders.map((entry) => ({ kind: 'folder' as const, id: entry.id })),
        ],
      }),
    );
    renderPane();
    await flush();
    expect(screen.getByRole('button', { name: 'Choose…' })).toBeDisabled();
    expect(screen.getByText('Remove a folder to add another.')).toBeInTheDocument();
  });

  it('shows what is zipping right now with a Cancel, and hides the section when idle', async () => {
    ipc.getDropActionsSnapshot.mockResolvedValue(
      snapshot([{ id: 4, action: 'zip', count: 3, state: { kind: 'running', percent: 40 } }]),
    );
    renderPane();
    await flush();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Zipping 3 items')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ipc.dropCancelJob).toHaveBeenCalledWith(4);

    act(() => {
      for (const listener of ipc.listeners) {
        listener({
          payload: {
            snapshot: snapshot([
              { id: 4, action: 'zip', count: 3, state: { kind: 'done' } },
              { id: 5, action: 'unzip', count: 1, state: { kind: 'running', percent: null } },
            ]),
          },
        });
      }
    });
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Unzipping 1 archive')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);

    act(() => {
      for (const listener of ipc.listeners) {
        listener({ payload: { snapshot: snapshot([]) } });
      }
    });
    expect(screen.queryByText('In progress')).toBeNull();
  });
});
