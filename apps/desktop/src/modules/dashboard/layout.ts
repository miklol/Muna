import {
  clampDashboardSlots,
  DASHBOARD_GRID,
  type DashboardSlot,
  type DashboardSpan,
} from '@muna/contracts';

/** A card's box in viewport px, as `getBoundingClientRect()` reports it. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Grid cells the slots occupy together. */
export const totalSpan = (slots: readonly DashboardSlot[]): number =>
  slots.reduce((sum, slot) => sum + slot.span, 0);

/** Cells left on the grid. */
export const freeCells = (slots: readonly DashboardSlot[]): number =>
  DASHBOARD_GRID.cells - totalSpan(slots);

/**
 * The slots the grid shows: those whose module is enabled and has a widget, in stored order.
 * A disabled module's slot stays in the document so re-enabling it brings the widget back.
 */
export const visibleSlots = (
  slots: readonly DashboardSlot[],
  hasWidget: (moduleId: string) => boolean,
  disabled: readonly string[],
): DashboardSlot[] =>
  slots.filter((slot) => hasWidget(slot.moduleId) && !disabled.includes(slot.moduleId));

/**
 * The document to save after editing the visible slots: the edited ones in their new order,
 * then the hidden ones as they were, clamped so the grid never overflows. The hidden ones come
 * last so an edit that fills the grid drops them rather than what the user just placed.
 */
export const mergeHidden = (
  edited: readonly DashboardSlot[],
  stored: readonly DashboardSlot[],
  visible: readonly DashboardSlot[],
): DashboardSlot[] => {
  const shown = new Set(visible.map((slot) => slot.moduleId));
  const hidden = stored.filter((slot) => !shown.has(slot.moduleId));
  return clampDashboardSlots([...edited, ...hidden]);
};

/** `slots` with the slot at `from` moved to `to`; unchanged when either index is out of range. */
export const moveSlot = (
  slots: readonly DashboardSlot[],
  from: number,
  to: number,
): DashboardSlot[] => {
  if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) {
    return [...slots];
  }
  const next = [...slots];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...slots];
  next.splice(to, 0, moved);
  return next;
};

/** Whether the slot at `index` can take `span` without the grid overflowing. */
export const canSetSpan = (
  slots: readonly DashboardSlot[],
  index: number,
  span: DashboardSpan,
): boolean => {
  const slot = slots[index];
  if (slot === undefined) return false;
  return totalSpan(slots) - slot.span + span <= DASHBOARD_GRID.cells;
};

/** `slots` with the slot at `index` at `span`; unchanged when that would overflow the grid. */
export const setSpan = (
  slots: readonly DashboardSlot[],
  index: number,
  span: DashboardSpan,
): DashboardSlot[] => {
  if (!canSetSpan(slots, index, span)) return [...slots];
  return slots.map((slot, at) => (at === index ? { ...slot, span } : slot));
};

export const removeSlot = (slots: readonly DashboardSlot[], moduleId: string): DashboardSlot[] =>
  slots.filter((slot) => slot.moduleId !== moduleId);

/**
 * `slots` with `moduleId` appended at span 1; unchanged when it is already there or the grid is
 * full (the add controls only offer what fits, so this is a guard, not a message).
 */
export const addSlot = (slots: readonly DashboardSlot[], moduleId: string): DashboardSlot[] => {
  if (slots.some((slot) => slot.moduleId === moduleId) || freeCells(slots) < 1) return [...slots];
  return [...slots, { moduleId, span: 1 }];
};

const contains = (rect: Rect, point: Point): boolean =>
  point.x >= rect.left &&
  point.x < rect.left + rect.width &&
  point.y >= rect.top &&
  point.y < rect.top + rect.height;

/**
 * Where a card dragged from `from` lands: the index of the card under the pointer, or `from`
 * when it was let go over its own place, a gap or outside the grid. The dragged card's own box
 * moves with the pointer, so it is never the target.
 */
export const dropIndex = (rects: readonly (Rect | null)[], point: Point, from: number): number => {
  const hit = rects.findIndex(
    (rect, index) => index !== from && rect !== null && contains(rect, point),
  );
  return hit === -1 ? from : hit;
};
