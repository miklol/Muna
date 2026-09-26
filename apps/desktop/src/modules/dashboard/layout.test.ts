import { DASHBOARD_GRID, type DashboardSlot, DEFAULT_DASHBOARD_SLOTS } from '@muna/contracts';
import { describe, expect, it } from 'vitest';

import {
  addSlot,
  canSetSpan,
  dropIndex,
  freeCells,
  mergeHidden,
  moveSlot,
  type Rect,
  removeSlot,
  setSpan,
  totalSpan,
  visibleSlots,
} from './layout';

const slot = (moduleId: string, span: 1 | 2 = 1): DashboardSlot => ({ moduleId, span });
const ids = (slots: readonly DashboardSlot[]) => slots.map((entry) => entry.moduleId);

const four = [slot('a', 2), slot('b'), slot('c'), slot('d')];

describe('dashboard layout', () => {
  it('counts the cells the slots take and what is left', () => {
    expect(totalSpan(DEFAULT_DASHBOARD_SLOTS)).toBe(DASHBOARD_GRID.cells);
    expect(freeCells(DEFAULT_DASHBOARD_SLOTS)).toBe(0);
    expect(totalSpan(four)).toBe(5);
    expect(freeCells(four)).toBe(3);
    expect(freeCells([])).toBe(DASHBOARD_GRID.cells);
  });

  it('shows only enabled modules with a widget, in stored order', () => {
    const hasWidget = (id: string) => id !== 'c';
    expect(ids(visibleSlots(four, hasWidget, ['b']))).toEqual(['a', 'd']);
    expect(ids(visibleSlots(four, () => true, []))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('merges the edited visible slots back in front of the hidden ones and clamps the result', () => {
    const stored = [slot('a', 2), slot('hidden'), slot('b'), slot('c')];
    const visible = [slot('a', 2), slot('b'), slot('c')];
    const edited = [slot('c'), slot('b'), slot('a', 2)];
    expect(ids(mergeHidden(edited, stored, visible))).toEqual(['c', 'b', 'a', 'hidden']);

    // Removing a visible slot removes it for good; the hidden one is still kept.
    expect(ids(mergeHidden([slot('a', 2), slot('b')], stored, visible))).toEqual([
      'a',
      'b',
      'hidden',
    ]);

    // Filling the grid drops the hidden slot rather than what the user placed.
    const full = [slot('a', 2), slot('b', 2), slot('c', 2), slot('d', 2)];
    expect(ids(mergeHidden(full, [...full, slot('hidden')], full))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves a slot to another index and ignores impossible moves', () => {
    expect(ids(moveSlot(four, 0, 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(moveSlot(four, 3, 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(moveSlot(four, 1, 1))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(moveSlot(four, -1, 1))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(moveSlot(four, 1, 4))).toEqual(['a', 'b', 'c', 'd']);
    expect(moveSlot(four, 0, 1)).not.toBe(four);
  });

  it('widens only while the grid has room, and narrows always', () => {
    expect(canSetSpan(four, 1, 2)).toBe(true);
    expect(setSpan(four, 1, 2)[1]).toEqual(slot('b', 2));
    expect(setSpan(four, 0, 1)[0]).toEqual(slot('a', 1));

    const full = DEFAULT_DASHBOARD_SLOTS;
    expect(canSetSpan(full, 1, 2)).toBe(false);
    expect(setSpan(full, 1, 2)).toEqual(full);
    expect(canSetSpan(full, 0, 1)).toBe(true);
    expect(canSetSpan(full, 99, 2)).toBe(false);
    // Exactly one cell left: widening fits.
    const seven = [slot('a', 2), slot('b', 2), slot('c', 2), slot('d')];
    expect(canSetSpan(seven, 3, 2)).toBe(true);
  });

  it('removes by module id and adds at span 1 while there is room and no duplicate', () => {
    expect(ids(removeSlot(four, 'b'))).toEqual(['a', 'c', 'd']);
    expect(ids(removeSlot(four, 'nope'))).toEqual(['a', 'b', 'c', 'd']);

    expect(addSlot(four, 'e')).toEqual([...four, slot('e')]);
    expect(addSlot(four, 'a')).toEqual(four);
    expect(addSlot(DEFAULT_DASHBOARD_SLOTS, 'e')).toEqual(DEFAULT_DASHBOARD_SLOTS);
  });

  it('drops a dragged card on the card under the pointer, else back where it came from', () => {
    const rects: Rect[] = [
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 100, top: 0, width: 100, height: 100 },
      { left: 0, top: 100, width: 100, height: 100 },
    ];
    expect(dropIndex(rects, { x: 150, y: 50 }, 0)).toBe(1);
    expect(dropIndex(rects, { x: 50, y: 150 }, 0)).toBe(2);
    // Over its own (moved) box, a gap, or outside the grid: no move.
    expect(dropIndex(rects, { x: 50, y: 50 }, 0)).toBe(0);
    expect(dropIndex(rects, { x: 150, y: 150 }, 0)).toBe(0);
    expect(dropIndex(rects, { x: -10, y: -10 }, 1)).toBe(1);
    // A card that could not be measured is never a target.
    expect(dropIndex([rects[0] ?? null, null, rects[2] ?? null], { x: 150, y: 50 }, 0)).toBe(0);
  });
});
