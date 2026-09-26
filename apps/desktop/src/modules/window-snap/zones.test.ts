import { defaultWindowSnapSettings, SNAP_ZONES } from '@muna/contracts';
import type { Translate } from '@muna/i18n';
import { describe, expect, it } from 'vitest';

import {
  cellGlyph,
  measureTiles,
  snapTiles,
  tileAt,
  zoneGlyph,
  zoneKey,
  zoneLabelKey,
} from './zones';

/** Echoes the key and any placeholders, so labels can be asserted without the catalog. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options === undefined ? key : `${key} ${JSON.stringify(options)}`) as unknown as Translate;

describe('snap zones', () => {
  it('lists the enabled built-ins in strip order, then the grid cells row by row', () => {
    const builtIns = snapTiles(defaultWindowSnapSettings(), t);
    expect(builtIns.map((tile) => tile.key)).toEqual(SNAP_ZONES.map((zone) => `builtIn:${zone}`));
    expect(builtIns[0]).toEqual({
      key: 'builtIn:topLeft',
      ref: { builtIn: 'topLeft' },
      label: 'windowSnap.zone.topLeft',
      glyph: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });

    const mixed = snapTiles(
      { zones: ['leftHalf', 'rightHalf'], grid: { rows: 2, cols: 2, gap: 8 } },
      t,
    );
    expect(mixed.map((tile) => tile.key)).toEqual([
      'builtIn:leftHalf',
      'builtIn:rightHalf',
      'cell:0:0',
      'cell:0:1',
      'cell:1:0',
      'cell:1:1',
    ]);
    expect(mixed[5]).toEqual({
      key: 'cell:1:1',
      ref: { cell: { row: 1, col: 1 } },
      label: 'windowSnap.zone.cell {"row":2,"col":2}',
      glyph: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    });
    expect(
      snapTiles({ zones: [], grid: { rows: 1, cols: 3, gap: 0 } }, t).map((tile) => tile.key),
    ).toEqual(['cell:0:0', 'cell:0:1', 'cell:0:2']);
  });

  it('draws every built-in zone inside the screen and the grid cells edge to edge', () => {
    for (const zone of SNAP_ZONES) {
      const glyph = zoneGlyph(zone);
      expect(glyph.x).toBeGreaterThanOrEqual(0);
      expect(glyph.y).toBeGreaterThanOrEqual(0);
      expect(glyph.x + glyph.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(glyph.y + glyph.height).toBeLessThanOrEqual(1 + 1e-9);
      expect(zoneLabelKey(zone)).toBe(`windowSnap.zone.${zone}`);
    }
    expect(zoneGlyph('maximize')).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(zoneGlyph('centerThird').x).toBeCloseTo(1 / 3);
    expect(cellGlyph({ rows: 4, cols: 2, gap: 0 }, 3, 1)).toEqual({
      x: 0.5,
      y: 0.75,
      width: 0.5,
      height: 0.25,
    });
    expect(zoneKey({ builtIn: 'maximize' })).toBe('builtIn:maximize');
    expect(zoneKey({ cell: { row: 0, col: 3 } })).toBe('cell:0:3');
  });

  it('finds the tile under a point from measured boxes, and nothing without a root', () => {
    const rects = [
      { key: 'a', left: 0, top: 0, width: 76, height: 60 },
      { key: 'b', left: 80, top: 0, width: 76, height: 60 },
    ];
    expect(tileAt(rects, { x: 10, y: 10 })).toBe('a');
    expect(tileAt(rects, { x: 80, y: 59 })).toBe('b');
    // Right and bottom edges are exclusive, gaps belong to no tile.
    expect(tileAt(rects, { x: 76, y: 10 })).toBeNull();
    expect(tileAt(rects, { x: 10, y: 60 })).toBeNull();
    expect(tileAt([], { x: 0, y: 0 })).toBeNull();
    expect(measureTiles(null)).toEqual([]);
  });
});
