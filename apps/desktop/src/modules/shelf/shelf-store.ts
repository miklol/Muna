import type { ShelfItem, ShelfSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface ShelfStore {
  /** Last `ShelfChanged`; `null` until the first snapshot arrives. */
  snapshot: ShelfSnapshot | null;
  /** Ids of the selected items, in selection order; pruned when an item leaves the snapshot. */
  selected: readonly string[];
  setSnapshot: (snapshot: ShelfSnapshot) => void;
  toggle: (id: string) => void;
  select: (ids: readonly string[]) => void;
  clearSelection: () => void;
}

/**
 * The Shelf's mirror of the Rust item store (docs/modules/shelf.md) plus the panel's
 * selection. Fed by `useShelfSubscription` while the panel or the settings pane is mounted;
 * nothing here polls. The selection lives here rather than in the panel so it survives the
 * panel unmounting between opens of the notch.
 */
export const useShelfStore = create<ShelfStore>()((set) => ({
  snapshot: null,
  selected: [],
  setSnapshot: (snapshot) => {
    set((store) => {
      const present = new Set(snapshot.items.map((item) => item.id));
      const selected = store.selected.filter((id) => present.has(id));
      return {
        snapshot,
        selected: selected.length === store.selected.length ? store.selected : selected,
      };
    });
  },
  toggle: (id) => {
    set((store) => ({
      selected: store.selected.includes(id)
        ? store.selected.filter((candidate) => candidate !== id)
        : [...store.selected, id],
    }));
  },
  select: (ids) => {
    set({ selected: [...ids] });
  },
  clearSelection: () => {
    set({ selected: [] });
  },
}));

/** Newest first: the panel reads left to right, top to bottom, so the latest drop leads. */
export const orderedItems = (items: readonly ShelfItem[]): ShelfItem[] =>
  [...items].sort((a, b) => b.addedAtMs - a.addedAtMs);

/**
 * What a drag or a toolbar action works on: the selection when `id` is part of it (or absent),
 * else the one item under the pointer, so dragging an unselected tile carries just that tile.
 */
export const targetIds = (selected: readonly string[], id?: string): readonly string[] => {
  if (id === undefined) return selected;
  return selected.includes(id) ? selected : [id];
};

/** A snippet that is one `http(s)` URL and nothing else shows the link glyph. */
export const isLink = (preview: string | null): boolean =>
  preview !== null && /^https?:\/\/\S+$/u.test(preview.trim());

/** `1.2 MB`-style sizes for the tile tooltip; `null` when the size is unknown. */
export const formatSize = (bytes: number | null, locale: string): string | null => {
  if (bytes === null) return null;
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[unit],
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
};
