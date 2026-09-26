import {
  DEFAULT_DROP_TILES,
  type DropActionsSettings,
  type DropItem,
  defaultDropActionsSettings,
} from '@muna/contracts';
import { describe, expect, it } from 'vitest';

import { i18n } from '../../lib/i18n';
import {
  builtInTile,
  isArchive,
  MORE_KEY,
  moveEntry,
  rowColumns,
  rowLayout,
  runnableTile,
  type TileEntry,
  tileAt,
  tileEntries,
} from './tiles';

const t = i18n.t.bind(i18n);

const file = (name: string, extension: string | null = null): DropItem => ({
  name,
  extension,
  isDirectory: false,
});
const folderItem: DropItem = { name: 'Photos', extension: null, isDirectory: true };
const pdf = file('report.pdf', 'pdf');
const zip = file('bundle.zip', 'zip');

const withFolders = (): DropActionsSettings => ({
  ...defaultDropActionsSettings(),
  folders: [
    { id: 'f1', name: 'OneDrive', path: 'C:\\Users\\me\\OneDrive', mode: 'copy' },
    { id: 'f2', name: 'Archive', path: 'D:\\Archive', mode: 'move' },
  ],
  tiles: [
    { kind: 'folder', id: 'f1' },
    { kind: 'divider' },
    { kind: 'folder', id: 'f2' },
    { kind: 'folder', id: 'gone' },
    { kind: 'zip' },
    { kind: 'unzip' },
  ],
});

const keysOf = (row: readonly TileEntry[]) => row.map((entry) => entry.key);

describe('isArchive', () => {
  it('recognises zip files by extension, case-insensitively, and never folders', () => {
    expect(isArchive(zip)).toBe(true);
    expect(isArchive(file('BUNDLE.ZIP', 'ZIP'))).toBe(true);
    expect(isArchive(pdf)).toBe(false);
    expect(isArchive(file('noext'))).toBe(false);
    expect(isArchive({ ...folderItem, extension: 'zip' })).toBe(false);
  });
});

describe('builtInTile', () => {
  it('gives every built-in tile its words, glyph and action', () => {
    expect(builtInTile({ kind: 'nearbyShare' }, [pdf], t)).toEqual({
      kind: 'tile',
      key: 'nearbyShare',
      icon: 'share',
      title: 'Nearby Share',
      subtitle: 'Share sheet',
      action: { kind: 'share' },
      enabled: true,
    });
    expect(builtInTile({ kind: 'copyTo' }, [pdf], t)).toMatchObject({
      icon: 'copyTo',
      title: 'Copy to',
      subtitle: 'Choose a folder',
      action: { kind: 'copyTo', title: 'Copy to' },
    });
    expect(builtInTile({ kind: 'moveTo' }, [pdf], t)).toMatchObject({
      action: { kind: 'moveTo', title: 'Move to' },
    });
    expect(builtInTile({ kind: 'trash' }, [pdf], t)).toMatchObject({
      title: 'Recycle Bin',
      subtitle: 'Undo in Explorer',
      action: { kind: 'trash' },
    });
    expect(builtInTile({ kind: 'eject' }, [pdf], t)).toMatchObject({ action: { kind: 'eject' } });
    expect(builtInTile({ kind: 'reveal' }, [pdf], t)).toMatchObject({ icon: 'reveal' });
    expect(builtInTile({ kind: 'openWith' }, [pdf], t)).toMatchObject({ icon: 'openWith' });
    expect(builtInTile({ kind: 'zip' }, [pdf], t)).toMatchObject({ icon: 'zip', enabled: true });
  });

  it('enables Unzip only when one of the items is an archive', () => {
    expect(builtInTile({ kind: 'unzip' }, [pdf, folderItem], t).enabled).toBe(false);
    expect(builtInTile({ kind: 'unzip' }, [pdf, zip], t).enabled).toBe(true);
    expect(builtInTile({ kind: 'unzip' }, [], t).enabled).toBe(false);
  });
});

describe('tileEntries', () => {
  it('follows the settings order with the default tiles', () => {
    const entries = tileEntries(defaultDropActionsSettings(), [pdf], t);
    expect(keysOf(entries)).toEqual(DEFAULT_DROP_TILES.map((tile) => tile.kind));
    expect(entries.every((entry) => entry.kind === 'tile')).toBe(true);
  });

  it('names folder tiles after the folder, keeps dividers and skips folders that are gone', () => {
    const entries = tileEntries(withFolders(), [pdf], t);
    expect(keysOf(entries)).toEqual(['folder:f1', 'divider:1', 'folder:f2', 'zip', 'unzip']);
    expect(entries[0]).toEqual({
      kind: 'tile',
      key: 'folder:f1',
      icon: 'folderCopy',
      title: 'OneDrive',
      subtitle: 'Copy here',
      action: { kind: 'folder', id: 'f1' },
      enabled: true,
    });
    expect(entries[2]).toMatchObject({
      icon: 'folderMove',
      title: 'Archive',
      subtitle: 'Move here',
      action: { kind: 'folder', id: 'f2' },
    });
    expect(entries[4]).toMatchObject({ key: 'unzip', enabled: false });
  });

  it('dims the Shelf tile while the Shelf module is turned off', () => {
    const on = tileEntries(defaultDropActionsSettings(), [pdf], t, ['weather']);
    expect(on[1]).toMatchObject({ key: 'shelf', enabled: true });
    const off = tileEntries(defaultDropActionsSettings(), [pdf], t, ['shelf']);
    expect(off[1]).toMatchObject({ key: 'shelf', enabled: false, action: { kind: 'shelf' } });
    expect(keysOf(off.filter((entry) => entry.kind === 'tile' && !entry.enabled))).toEqual([
      'shelf',
      'unzip',
    ]);
  });
});

describe('rowLayout', () => {
  const entries = tileEntries(defaultDropActionsSettings(), [pdf], t);

  it('shows every tile in one row when they fit', () => {
    const layout = rowLayout(entries.slice(0, 4), 4, false, t);
    expect(layout.hidden).toBe(0);
    expect(layout.rows.map(keysOf)).toEqual([['nearbyShare', 'shelf', 'copyTo', 'moveTo']]);
  });

  it('replaces the last slot with a More tile that counts the hidden ones until revealed', () => {
    const layout = rowLayout(entries, 4, false, t);
    expect(layout.hidden).toBe(7);
    expect(layout.rows.map(keysOf)).toEqual([['nearbyShare', 'shelf', 'copyTo', MORE_KEY]]);
    expect(layout.rows[0]?.[3]).toMatchObject({
      kind: 'tile',
      icon: 'more',
      title: 'More',
      subtitle: '7 more tiles',
      action: null,
      enabled: true,
    });
    expect(rowLayout(entries.slice(0, 5), 4, false, t).rows[0]?.[3]).toMatchObject({
      subtitle: '2 more tiles',
    });
  });

  it('lays the tiles out in rows of perRow once revealed; eight per row when expanded', () => {
    const revealed = rowLayout(entries, 4, true, t);
    expect(revealed.hidden).toBe(0);
    expect(revealed.rows.map(keysOf)).toEqual([
      ['nearbyShare', 'shelf', 'copyTo', 'moveTo'],
      ['openWith', 'zip', 'unzip', 'reveal'],
      ['trash', 'eject'],
    ]);
    expect(rowLayout(entries, 8, false, t).rows.map(keysOf)).toEqual([
      ['nearbyShare', 'shelf', 'copyTo', 'moveTo', 'openWith', 'zip', 'unzip', MORE_KEY],
    ]);
    expect(rowLayout(entries, 8, true, t).rows.map(keysOf)).toEqual([
      ['nearbyShare', 'shelf', 'copyTo', 'moveTo', 'openWith', 'zip', 'unzip', 'reveal'],
      ['trash', 'eject'],
    ]);
  });

  it('keeps dividers between tiles but never at a row edge, and drops divider-only rows', () => {
    const divided: TileEntry[] = [
      { kind: 'divider', key: 'd0' },
      ...entries.slice(0, 2),
      { kind: 'divider', key: 'd1' },
      ...entries.slice(2, 4),
      { kind: 'divider', key: 'd2' },
      ...entries.slice(4, 5),
      { kind: 'divider', key: 'd3' },
    ];
    expect(rowLayout(divided, 8, false, t).rows.map(keysOf)).toEqual([
      ['nearbyShare', 'shelf', 'd1', 'copyTo', 'moveTo', 'd2', 'openWith'],
    ]);
    // Split at four: the divider that would open row two is trimmed.
    expect(rowLayout(divided, 4, true, t).rows.map(keysOf)).toEqual([
      ['nearbyShare', 'shelf', 'd1', 'copyTo', 'moveTo'],
      ['openWith'],
    ]);
    // Collapsed, the divider before the More tile is trimmed too.
    expect(rowLayout(divided, 3, false, t).rows.map(keysOf)).toEqual([
      ['nearbyShare', 'shelf', MORE_KEY],
    ]);
  });

  it('never builds a row narrower than one tile', () => {
    expect(rowLayout(entries.slice(0, 2), 0, false, t).rows.map(keysOf)).toEqual([
      ['nearbyShare', MORE_KEY],
    ]);
    expect(rowLayout(entries.slice(0, 2), 1, true, t).rows.map(keysOf)).toEqual([
      ['nearbyShare'],
      ['shelf'],
    ]);
  });
});

describe('rowColumns', () => {
  it('gives tiles a shrinkable track and dividers a fixed gap', () => {
    const row = rowLayout(
      [
        ...tileEntries(defaultDropActionsSettings(), [pdf], t).slice(0, 1),
        { kind: 'divider', key: 'd' },
        ...tileEntries(defaultDropActionsSettings(), [pdf], t).slice(1, 2),
      ],
      4,
      false,
      t,
    ).rows[0];
    expect(row).toBeDefined();
    expect(rowColumns(row ?? [])).toBe(
      'minmax(0, var(--drop-tile-width)) var(--drop-divider) minmax(0, var(--drop-tile-width))',
    );
  });
});

describe('moveEntry', () => {
  it('moves an entry one step and ignores moves off either end', () => {
    expect(moveEntry(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveEntry(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    const list = ['a', 'b', 'c'];
    expect(moveEntry(list, 0, -1)).toBe(list);
    expect(moveEntry(list, 2, 1)).toBe(list);
    expect(moveEntry(list, 5, -1)).toBe(list);
  });
});

describe('tileAt and runnableTile', () => {
  const rects = [
    { key: 'nearbyShare', left: 0, top: 0, width: 100, height: 80 },
    { key: 'unzip', left: 100, top: 0, width: 100, height: 80 },
    { key: MORE_KEY, left: 200, top: 0, width: 100, height: 80 },
  ];

  it('finds the tile under a point with half-open edges', () => {
    expect(tileAt(rects, { x: 0, y: 0 })).toBe('nearbyShare');
    expect(tileAt(rects, { x: 99.9, y: 79 })).toBe('nearbyShare');
    expect(tileAt(rects, { x: 100, y: 10 })).toBe('unzip');
    expect(tileAt(rects, { x: 250, y: 80 })).toBeNull();
    expect(tileAt(rects, { x: -1, y: 10 })).toBeNull();
  });

  it('returns only enabled action tiles: never More, a dimmed Unzip or an unknown key', () => {
    const noArchive = rowLayout(tileEntries(defaultDropActionsSettings(), [pdf], t), 8, true, t);
    expect(runnableTile(noArchive, 'nearbyShare')).toMatchObject({ action: { kind: 'share' } });
    expect(runnableTile(noArchive, 'unzip')).toBeNull();
    expect(runnableTile(noArchive, 'missing')).toBeNull();
    expect(runnableTile(noArchive, null)).toBeNull();

    const archive = rowLayout(tileEntries(defaultDropActionsSettings(), [zip], t), 8, true, t);
    expect(runnableTile(archive, 'unzip')).toMatchObject({ action: { kind: 'unzip' } });
    // The row spanning two rows still finds the tile on the second one.
    expect(runnableTile(archive, 'eject')).toMatchObject({ action: { kind: 'eject' } });

    const collapsed = rowLayout(tileEntries(defaultDropActionsSettings(), [zip], t), 4, false, t);
    expect(runnableTile(collapsed, MORE_KEY)).toBeNull();
  });
});
