import {
  commands,
  DEFAULT_DROP_TILES,
  DROP_MAX_FOLDERS,
  type DropActionsSettings,
  type DropFolder,
  type DropJob,
  dropFolderDisplayName,
  type DropTile,
  normaliseDropActionsSettings,
  readDropActionsSettings,
  type TransferMode,
  writeDropActionsSettings,
} from '@muna/contracts';
import {
  Button,
  IconButton,
  ListRow,
  SegmentedControl,
  type SegmentedControlItem,
  Text,
  Toggle,
} from '@muna/ui';
import { ChevronDown, ChevronUp, FolderPlus, Minus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setModuleEnabled } from '../../settings/panes/modules';
import { ActionRow, type RowSpec, Section, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { TileGlyph } from './tile-icon';
import { type BuiltInTile, builtInTile, moveEntry } from './tiles';
import { useDropJobs } from './use-drop-actions-snapshot';
import './settings.css';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/** The module id the shell's `disabledModules` list names (docs/modules/settings.md). */
export const DROP_ACTIONS_MODULE_ID = 'drop-actions';

/** Settings rows draw Lucide at 20 px, stroke 1.5 (Settings › Modules does the same). */
const ROW_ICON_SIZE = 20;
const ICON_STROKE = 1.75;

const isBuiltIn = (tile: DropTile): tile is BuiltInTile =>
  tile.kind !== 'folder' && tile.kind !== 'divider';

const sameTile = (a: DropTile, b: DropTile): boolean =>
  a.kind === b.kind && (a.kind !== 'folder' || b.kind !== 'folder' || a.id === b.id);

/** Built-in tiles the row does not show, in their default order — they can be turned back on. */
export const hiddenBuiltIns = (settings: DropActionsSettings): readonly BuiltInTile[] =>
  DEFAULT_DROP_TILES.filter(isBuiltIn).filter(
    (candidate) => !settings.tiles.some((tile) => sameTile(tile, candidate)),
  );

/** Shows or hides a built-in tile: on appends it to the row, off removes it. */
export const setTileShown = (
  settings: DropActionsSettings,
  tile: BuiltInTile,
  shown: boolean,
): DropActionsSettings => ({
  ...settings,
  tiles: shown
    ? [...settings.tiles.filter((candidate) => !sameTile(candidate, tile)), tile]
    : settings.tiles.filter((candidate) => !sameTile(candidate, tile)),
});

/** Adds a picked folder as a copy tile; a folder already listed (any case) is left alone. */
export const addFolder = (
  settings: DropActionsSettings,
  path: string,
  id: string,
): DropActionsSettings => {
  const known = settings.folders.some((folder) => folder.path.toLowerCase() === path.toLowerCase());
  if (known || settings.folders.length >= DROP_MAX_FOLDERS) {
    return settings;
  }
  const folder: DropFolder = { id, name: dropFolderDisplayName(path), path, mode: 'copy' };
  return {
    ...settings,
    folders: [...settings.folders, folder],
    tiles: [...settings.tiles, { kind: 'folder', id }],
  };
};

export const removeFolder = (settings: DropActionsSettings, id: string): DropActionsSettings => ({
  ...settings,
  folders: settings.folders.filter((folder) => folder.id !== id),
  tiles: settings.tiles.filter((tile) => tile.kind !== 'folder' || tile.id !== id),
});

export const setFolderMode = (
  settings: DropActionsSettings,
  id: string,
  mode: TransferMode,
): DropActionsSettings => ({
  ...settings,
  folders: settings.folders.map((folder) => (folder.id === id ? { ...folder, mode } : folder)),
});

const newFolderId = (): string => crypto.randomUUID();

/**
 * Settings › Drop actions (docs/modules/drop-actions.md "Order, folders, dividers, width in
 * Settings"): whether drops show the row at all and how wide it is, the tiles in order with
 * show/hide and ▲▼, the folders with their copy-or-move mode, and whatever is zipping right
 * now. Every write goes through the shared editor; Rust normalises the namespace on save
 * exactly as `normaliseDropActionsSettings` does here, so the pane never shows a state the
 * document will not keep.
 */
export function DropActionsSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const dropSettings = readDropActionsSettings(settings);
  const enabled = !settings.shell.disabledModules.includes(DROP_ACTIONS_MODULE_ID);
  const jobs = useDropJobs();
  const [picking, setPicking] = useState(false);

  const write = (recipe: (current: DropActionsSettings) => DropActionsSettings) => {
    update((current) =>
      writeDropActionsSettings(
        current,
        normaliseDropActionsSettings(recipe(readDropActionsSettings(current))),
      ),
    );
  };

  const pickFolder = () => {
    setPicking(true);
    void commands
      .dropPickFolder(t('dropActions.settings.pickFolderTitle'))
      .then((result) => {
        if (result.status === 'ok' && result.data !== null) {
          const path = result.data;
          write((current) => addFolder(current, path, newFolderId()));
        }
      })
      .catch(() => {
        // Not running inside Tauri: there is no picker to show.
      })
      .finally(() => {
        setPicking(false);
      });
  };

  const folderOf = (id: string): DropFolder | undefined =>
    dropSettings.folders.find((folder) => folder.id === id);

  const orderControls = (name: string, index: number) => (
    <>
      <IconButton
        aria-label={t('dropActions.settings.moveUp', { name })}
        isDisabled={index === 0}
        onPress={() => {
          write((current) => ({ ...current, tiles: [...moveEntry(current.tiles, index, -1)] }));
        }}
      >
        <ChevronUp strokeWidth={ICON_STROKE} />
      </IconButton>
      <IconButton
        aria-label={t('dropActions.settings.moveDown', { name })}
        isDisabled={index === dropSettings.tiles.length - 1}
        onPress={() => {
          write((current) => ({ ...current, tiles: [...moveEntry(current.tiles, index, 1)] }));
        }}
      >
        <ChevronDown strokeWidth={ICON_STROKE} />
      </IconButton>
    </>
  );

  const tileRows: RowSpec[] = dropSettings.tiles.flatMap((tile, index): RowSpec[] => {
    if (tile.kind === 'divider') {
      const name = t('dropActions.tiles.divider');
      return [
        {
          id: `dropActions.tile.divider.${String(index)}`,
          node: (
            <ListRow
              icon={<Minus size={ROW_ICON_SIZE} strokeWidth={1.5} aria-hidden focusable={false} />}
              label={name}
              description={t('dropActions.tiles.dividerBody')}
              trailingIsControl
              trailing={
                <span className="drop-settings__controls">
                  {orderControls(name, index)}
                  <IconButton
                    aria-label={t('dropActions.settings.remove', { name })}
                    onPress={() => {
                      write((current) => ({
                        ...current,
                        tiles: current.tiles.filter((_, candidate) => candidate !== index),
                      }));
                    }}
                  >
                    <X strokeWidth={ICON_STROKE} />
                  </IconButton>
                </span>
              }
            />
          ),
        },
      ];
    }
    if (tile.kind === 'folder') {
      const folder = folderOf(tile.id);
      if (folder === undefined) {
        return [];
      }
      return [
        {
          id: `dropActions.tile.folder.${folder.id}`,
          node: (
            <ListRow
              icon={
                <TileGlyph
                  icon={folder.mode === 'copy' ? 'folderCopy' : 'folderMove'}
                  size={ROW_ICON_SIZE}
                />
              }
              label={folder.name}
              description={t(
                folder.mode === 'copy'
                  ? 'dropActions.tiles.copyHere'
                  : 'dropActions.tiles.moveHere',
              )}
              trailingIsControl
              trailing={
                <span className="drop-settings__controls">{orderControls(folder.name, index)}</span>
              }
            />
          ),
        },
      ];
    }
    const entry = builtInTile(tile, [], t);
    return [
      {
        id: `dropActions.tile.${tile.kind}`,
        node: (
          <ListRow
            icon={<TileGlyph icon={entry.icon} size={ROW_ICON_SIZE} />}
            label={entry.title}
            description={entry.subtitle}
            trailingIsControl
            trailing={
              <span className="drop-settings__controls">
                {orderControls(entry.title, index)}
                <Toggle
                  aria-label={t('dropActions.settings.show', { name: entry.title })}
                  isSelected
                  onChange={(shown) => {
                    write((current) => setTileShown(current, tile, shown));
                  }}
                />
              </span>
            }
          />
        ),
      },
    ];
  });
  const hiddenRows: RowSpec[] = hiddenBuiltIns(dropSettings).map((tile) => {
    const entry = builtInTile(tile, [], t);
    return {
      id: `dropActions.tile.${tile.kind}`,
      node: (
        <ListRow
          className="drop-settings__hidden"
          icon={<TileGlyph icon={entry.icon} size={ROW_ICON_SIZE} />}
          label={entry.title}
          description={entry.subtitle}
          trailingIsControl
          trailing={
            <Toggle
              aria-label={t('dropActions.settings.show', { name: entry.title })}
              isSelected={false}
              onChange={(shown) => {
                write((current) => setTileShown(current, tile, shown));
              }}
            />
          }
        />
      ),
    };
  });

  const modeItems: SegmentedControlItem<TransferMode>[] = [
    { id: 'copy', label: t('dropActions.settings.copy') },
    { id: 'move', label: t('dropActions.settings.move') },
  ];
  const folderRows: RowSpec[] = dropSettings.folders.map((folder) => ({
    id: `dropActions.folder.${folder.id}`,
    node: (
      <ListRow
        icon={
          <TileGlyph
            icon={folder.mode === 'copy' ? 'folderCopy' : 'folderMove'}
            size={ROW_ICON_SIZE}
          />
        }
        label={folder.name}
        description={folder.path}
        trailingIsControl
        trailing={
          <span className="drop-settings__controls">
            <SegmentedControl
              aria-label={t('dropActions.settings.mode', { name: folder.name })}
              items={modeItems}
              value={folder.mode}
              onChange={(mode) => {
                write((current) => setFolderMode(current, folder.id, mode));
              }}
            />
            <IconButton
              aria-label={t('dropActions.settings.remove', { name: folder.name })}
              onPress={() => {
                write((current) => removeFolder(current, folder.id));
              }}
            >
              <X strokeWidth={ICON_STROKE} />
            </IconButton>
          </span>
        }
      />
    ),
  }));
  const foldersFull = dropSettings.folders.length >= DROP_MAX_FOLDERS;

  return (
    <>
      <Section
        title={t('dropActions.settings.general')}
        visible={everything}
        rows={[
          {
            id: 'dropActions.enabled',
            node: (
              <ToggleRow
                label={t('dropActions.settings.enabled')}
                description={t('dropActions.settings.enabledBody')}
                isSelected={enabled}
                onChange={(on) => {
                  update((current) => setModuleEnabled(current, DROP_ACTIONS_MODULE_ID, on));
                }}
              />
            ),
          },
          {
            id: 'dropActions.expandNotch',
            node: (
              <ToggleRow
                label={t('dropActions.settings.expandNotch')}
                description={t('dropActions.settings.expandNotchBody')}
                isSelected={dropSettings.expandNotch}
                onChange={(expandNotch) => {
                  write((current) => ({ ...current, expandNotch }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('dropActions.settings.tiles')}
        description={t('dropActions.settings.tilesBody')}
        visible={everything}
        rows={[
          ...tileRows,
          ...hiddenRows,
          {
            id: 'dropActions.addDivider',
            node: (
              <ActionRow
                label={t('dropActions.settings.addDivider')}
                description={t('dropActions.settings.addDividerBody')}
                action={
                  <Button
                    onPress={() => {
                      write((current) => ({
                        ...current,
                        tiles: [...current.tiles, { kind: 'divider' }],
                      }));
                    }}
                  >
                    {t('dropActions.settings.add')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
      <Section
        title={t('dropActions.settings.folders')}
        description={
          dropSettings.folders.length === 0
            ? t('dropActions.settings.foldersEmpty')
            : t('dropActions.settings.foldersBody')
        }
        visible={everything}
        rows={[
          ...folderRows,
          {
            id: 'dropActions.addFolder',
            node: (
              <ActionRow
                label={t('dropActions.settings.addFolder')}
                description={
                  foldersFull
                    ? t('dropActions.settings.addFolderFull')
                    : t('dropActions.settings.addFolderBody', { count: DROP_MAX_FOLDERS })
                }
                action={
                  <Button
                    icon={<FolderPlus strokeWidth={ICON_STROKE} />}
                    isDisabled={foldersFull || picking}
                    onPress={pickFolder}
                  >
                    {t('dropActions.settings.choose')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
      {jobs.length > 0 && (
        <Section
          title={t('dropActions.settings.activity')}
          description={t('dropActions.settings.activityBody')}
          visible={everything}
          rows={jobs.map((job) => ({
            id: `dropActions.job.${String(job.id)}`,
            node: <JobRow job={job} />,
          }))}
        />
      )}
    </>
  );
}

/** The message key of a job's title; `eject` has no count. */
const jobTitleKey = (action: DropJob['action']) => `dropActions.job.${action}` as const;

/** One running or just-finished file operation: its title, the percent when known, Cancel. */
function JobRow({ job }: { readonly job: DropJob }) {
  const { t } = useTranslation();
  const name = t(jobTitleKey(job.action), { count: job.count });
  if (job.state.kind === 'running') {
    const percent = job.state.percent;
    return (
      <ListRow
        label={name}
        description={percent === null ? undefined : t('dropActions.job.percent', { percent })}
        trailingIsControl
        trailing={
          <Button
            onPress={() => {
              void commands.dropCancelJob(job.id).catch(() => {
                // The job may have finished first; the next snapshot says so.
              });
            }}
          >
            {t('dropActions.settings.cancel')}
          </Button>
        }
      />
    );
  }
  return (
    <ListRow
      label={name}
      trailing={
        <Text variant="footnote" tone="secondary">
          {job.state.kind === 'done' ? t('dropActions.job.done') : t('dropActions.job.failed')}
        </Text>
      }
    />
  );
}
