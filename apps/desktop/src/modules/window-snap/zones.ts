import type {
  DropPoint,
  SnapGrid,
  SnapZone,
  SnapZoneRef,
  WindowSnapSettings,
} from '@muna/contracts';
import type { MessageKey, Translate } from '@muna/i18n';

/** Where a zone sits on the screen, as fractions of the work area; drawn by `ZoneGlyph`. */
export interface GlyphRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One tile of the snap surface: a built-in zone or a grid cell, in strip order. */
export interface SnapTile {
  /** `builtIn:<zone>` or `cell:<row>:<col>`; also the DOM hit-test key. */
  readonly key: string;
  readonly ref: SnapZoneRef;
  readonly label: string;
  readonly glyph: GlyphRect;
}

const THIRD = 1 / 3;

/** Mirrors `modules::window_snap::zones::zone_placement`, in fractions. */
const BUILT_IN_GLYPHS: Readonly<Record<SnapZone, GlyphRect>> = {
  topLeft: { x: 0, y: 0, width: 0.5, height: 0.5 },
  bottomLeft: { x: 0, y: 0.5, width: 0.5, height: 0.5 },
  leftHalf: { x: 0, y: 0, width: 0.5, height: 1 },
  maximize: { x: 0, y: 0, width: 1, height: 1 },
  rightHalf: { x: 0.5, y: 0, width: 0.5, height: 1 },
  topRight: { x: 0.5, y: 0, width: 0.5, height: 0.5 },
  bottomRight: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  leftThird: { x: 0, y: 0, width: THIRD, height: 1 },
  centerThird: { x: THIRD, y: 0, width: THIRD, height: 1 },
  rightThird: { x: 2 * THIRD, y: 0, width: THIRD, height: 1 },
};

export const zoneGlyph = (zone: SnapZone): GlyphRect => BUILT_IN_GLYPHS[zone];

export const cellGlyph = (grid: SnapGrid, row: number, col: number): GlyphRect => ({
  x: col / grid.cols,
  y: row / grid.rows,
  width: 1 / grid.cols,
  height: 1 / grid.rows,
});

/** Message key of a built-in zone's name. */
export const zoneLabelKey = (zone: SnapZone): MessageKey => `windowSnap.zone.${zone}`;

export const zoneKey = (ref: SnapZoneRef): string =>
  'builtIn' in ref
    ? `builtIn:${ref.builtIn}`
    : `cell:${String(ref.cell.row)}:${String(ref.cell.col)}`;

/**
 * The tiles the surface shows for `settings`: the enabled built-ins in strip order, then the
 * grid's cells row by row (docs/modules/window-snap.md "Zones"). Ten at most, by construction
 * of the settings.
 */
export const snapTiles = (settings: WindowSnapSettings, t: Translate): readonly SnapTile[] => {
  const builtIns = settings.zones.map((zone): SnapTile => {
    const ref: SnapZoneRef = { builtIn: zone };
    return { key: zoneKey(ref), ref, label: t(zoneLabelKey(zone)), glyph: zoneGlyph(zone) };
  });
  const grid = settings.grid;
  if (grid === null) {
    return builtIns;
  }
  const cells: SnapTile[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const ref: SnapZoneRef = { cell: { row, col } };
      cells.push({
        key: zoneKey(ref),
        ref,
        label: t('windowSnap.zone.cell', { row: row + 1, col: col + 1 }),
        glyph: cellGlyph(grid, row, col),
      });
    }
  }
  return [...builtIns, ...cells];
};

export interface TileRect {
  readonly key: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Every tile's box in client px — the space the drag's `position` is reported in. */
export const measureTiles = (root: HTMLElement | null): TileRect[] => {
  if (root === null) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>('[data-tile-key]')).map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      key: node.getAttribute('data-tile-key') ?? '',
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
};

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
