import type {
  DropAction,
  DropActionsSettings,
  DropItem,
  DropPoint,
  DropTile,
} from '@muna/contracts';
import type { Translate } from '@muna/i18n';

/** Which outline glyph a tile draws (`tile-icon.tsx` maps these to Lucide). */
export type TileIcon =
  | 'share'
  | 'shelf'
  | 'folderCopy'
  | 'folderMove'
  | 'copyTo'
  | 'moveTo'
  | 'openWith'
  | 'zip'
  | 'unzip'
  | 'reveal'
  | 'trash'
  | 'eject'
  | 'more';

/** One slot of the row as drawn: a tile the items can land on, or a divider between groups. */
export type TileEntry =
  | {
      readonly kind: 'tile';
      /** Stable within the row: the tile kind, `folder:<id>`, or `more`. */
      readonly key: string;
      readonly icon: TileIcon;
      readonly title: string;
      readonly subtitle: string;
      /** What landing here runs; `null` for the *More* tile, which only reveals the rest. */
      readonly action: DropAction | null;
      /** A tile the dropped items cannot use (Unzip without an archive) dims to 40 %. */
      readonly enabled: boolean;
    }
  | { readonly kind: 'divider'; readonly key: string };

export type ActionTile = Extract<TileEntry, { kind: 'tile' }>;

/** The key of the tile that reveals the hidden rows. */
export const MORE_KEY = 'more';

/** Whether a dragged item is something Unzip can open (`archive::is_archive` in Rust: zip). */
export const isArchive = (item: DropItem): boolean =>
  !item.isDirectory && item.extension !== null && item.extension.toLowerCase() === 'zip';

/** A built-in tile's kind: every `DropTile` but folders and dividers. */
export type BuiltInTile = Exclude<DropTile, { kind: 'folder' | 'divider' }>;

/** The words and glyph of a built-in tile; Unzip is enabled only when an item is an archive. */
export const builtInTile = (
  tile: BuiltInTile,
  items: readonly DropItem[],
  t: Translate,
): ActionTile => {
  switch (tile.kind) {
    case 'nearbyShare':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'share',
        title: t('dropActions.tiles.nearbyShare'),
        subtitle: t('dropActions.tiles.nearbyShareBody'),
        action: { kind: 'share' },
        enabled: true,
      };
    case 'shelf':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'shelf',
        title: t('dropActions.tiles.shelf'),
        subtitle: t('dropActions.tiles.shelfBody'),
        action: { kind: 'shelf' },
        enabled: true,
      };
    case 'copyTo':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'copyTo',
        title: t('dropActions.tiles.copyTo'),
        subtitle: t('dropActions.tiles.chooseFolder'),
        action: { kind: 'copyTo', title: t('dropActions.tiles.copyTo') },
        enabled: true,
      };
    case 'moveTo':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'moveTo',
        title: t('dropActions.tiles.moveTo'),
        subtitle: t('dropActions.tiles.chooseFolder'),
        action: { kind: 'moveTo', title: t('dropActions.tiles.moveTo') },
        enabled: true,
      };
    case 'openWith':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'openWith',
        title: t('dropActions.tiles.openWith'),
        subtitle: t('dropActions.tiles.openWithBody'),
        action: { kind: 'openWith' },
        enabled: true,
      };
    case 'zip':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'zip',
        title: t('dropActions.tiles.zip'),
        subtitle: t('dropActions.tiles.zipBody'),
        action: { kind: 'zip' },
        enabled: true,
      };
    case 'unzip':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'unzip',
        title: t('dropActions.tiles.unzip'),
        subtitle: t('dropActions.tiles.unzipBody'),
        action: { kind: 'unzip' },
        enabled: items.some(isArchive),
      };
    case 'reveal':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'reveal',
        title: t('dropActions.tiles.reveal'),
        subtitle: t('dropActions.tiles.revealBody'),
        action: { kind: 'reveal' },
        enabled: true,
      };
    case 'trash':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'trash',
        title: t('dropActions.tiles.trash'),
        subtitle: t('dropActions.tiles.trashBody'),
        action: { kind: 'trash' },
        enabled: true,
      };
    case 'eject':
      return {
        kind: 'tile',
        key: tile.kind,
        icon: 'eject',
        title: t('dropActions.tiles.eject'),
        subtitle: t('dropActions.tiles.ejectBody'),
        action: { kind: 'eject' },
        enabled: true,
      };
  }
};

/**
 * The row's entries in the settings' order (docs/modules/drop-actions.md "Tiles"): built-in
 * tiles as words, folder tiles named by the user, dividers kept as gaps. Folder tiles whose
 * folder is gone are skipped (the contracts' normaliser drops them on save too). The *Shelf*
 * tile is dimmed while its module is in `disabledModules`: Rust refuses the items then.
 */
export const tileEntries = (
  settings: DropActionsSettings,
  items: readonly DropItem[],
  t: Translate,
  disabledModules: readonly string[] = [],
): readonly TileEntry[] =>
  settings.tiles.flatMap((tile, index): TileEntry[] => {
    switch (tile.kind) {
      case 'divider':
        return [{ kind: 'divider', key: `divider:${String(index)}` }];
      case 'folder': {
        const folder = settings.folders.find((candidate) => candidate.id === tile.id);
        if (folder === undefined) {
          return [];
        }
        return [
          {
            kind: 'tile',
            key: `folder:${folder.id}`,
            icon: folder.mode === 'copy' ? 'folderCopy' : 'folderMove',
            title: folder.name,
            subtitle: t(
              folder.mode === 'copy' ? 'dropActions.tiles.copyHere' : 'dropActions.tiles.moveHere',
            ),
            action: { kind: 'folder', id: folder.id },
            enabled: true,
          },
        ];
      }
      case 'shelf': {
        const entry = builtInTile(tile, items, t);
        return [disabledModules.includes('shelf') ? { ...entry, enabled: false } : entry];
      }
      default:
        return [builtInTile(tile, items, t)];
    }
  });

export interface RowLayout {
  /** The entries of each row, top to bottom. */
  readonly rows: readonly (readonly TileEntry[])[];
  /** How many tiles the *More* tile stands in for; 0 when every tile shows. */
  readonly hidden: number;
}

const isTile = (entry: TileEntry): entry is ActionTile => entry.kind === 'tile';

/**
 * Splits the entries into rows of `perRow` tiles (dividers ride along without taking a slot).
 * Until `revealed`, a row that would overflow shows its first `perRow − 1` tiles and a *More*
 * tile that reveals the rest on hover (docs/modules/drop-actions.md "Reference": the Expand
 * tile reveals a second row).
 */
export const rowLayout = (
  entries: readonly TileEntry[],
  perRow: number,
  revealed: boolean,
  t: Translate,
): RowLayout => {
  const capacity = Math.max(1, perRow);
  const tileCount = entries.filter(isTile).length;
  if (tileCount <= capacity) {
    return { rows: [trimDividers(entries)], hidden: 0 };
  }
  if (!revealed) {
    const shown = Math.max(1, capacity - 1);
    const first: TileEntry[] = [];
    let seen = 0;
    for (const entry of entries) {
      if (isTile(entry)) {
        if (seen === shown) break;
        seen += 1;
      }
      first.push(entry);
    }
    const hidden = tileCount - shown;
    return {
      rows: [
        [
          ...trimDividers(first),
          {
            kind: 'tile',
            key: MORE_KEY,
            icon: 'more',
            title: t('dropActions.tiles.more'),
            subtitle: t('dropActions.tiles.moreBody', { count: hidden }),
            action: null,
            enabled: true,
          },
        ],
      ],
      hidden,
    };
  }
  const rows: TileEntry[][] = [];
  let row: TileEntry[] = [];
  let inRow = 0;
  for (const entry of entries) {
    if (isTile(entry) && inRow === capacity) {
      rows.push(row);
      row = [];
      inRow = 0;
    }
    if (isTile(entry)) {
      inRow += 1;
    }
    row.push(entry);
  }
  rows.push(row);
  return {
    rows: rows.map(trimDividers).filter((entries) => entries.length > 0),
    hidden: 0,
  };
};

/** Dividers at a row's edges would draw a gap into nothing. */
const trimDividers = (row: readonly TileEntry[]): TileEntry[] => {
  let start = 0;
  let end = row.length;
  while (start < end && row[start]?.kind === 'divider') start += 1;
  while (end > start && row[end - 1]?.kind === 'divider') end -= 1;
  return row.slice(start, end);
};

/**
 * The `grid-template-columns` of one row: a tile track grows to the tile width when the row
 * fits and shrinks evenly when the panel is narrower; a divider is a fixed gap.
 */
export const rowColumns = (row: readonly TileEntry[]): string =>
  row
    .map((entry) =>
      entry.kind === 'tile' ? 'minmax(0, var(--drop-tile-width))' : 'var(--drop-divider)',
    )
    .join(' ');

/** Moves the entry at `from` one step (Settings › Tiles ▲▼); a move off either end is ignored. */
export const moveEntry = <T>(list: readonly T[], from: number, delta: 1 | -1): readonly T[] => {
  const to = from + delta;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) {
    next.splice(to, 0, moved);
  }
  return next;
};

export interface TileRect {
  readonly key: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The key of the tile under `point` (both in the same CSS px space), or `null`. */
export const tileAt = (rects: readonly TileRect[], point: DropPoint): string | null => {
  for (const rect of rects) {
    if (
      point.x >= rect.left &&
      point.x < rect.left + rect.width &&
      point.y >= rect.top &&
      point.y < rect.top + rect.height
    ) {
      return rect.key;
    }
  }
  return null;
};

/** The action tile with `key`, if it is one and is enabled for these items. */
export const runnableTile = (
  layout: RowLayout,
  key: string | null,
): (ActionTile & { readonly action: DropAction }) | null => {
  if (key === null) return null;
  for (const row of layout.rows) {
    for (const entry of row) {
      if (entry.kind === 'tile' && entry.key === key) {
        return entry.enabled && entry.action !== null ? { ...entry, action: entry.action } : null;
      }
    }
  }
  return null;
};
