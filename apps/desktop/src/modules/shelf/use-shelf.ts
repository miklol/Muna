import { commands, events, type ShelfCommand, type ShelfItem } from '@muna/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { useShelfStore } from './shelf-store';

/**
 * Mirrors the Rust Shelf into `useShelfStore` while the caller is mounted: one
 * `get_shelf_snapshot` round trip, then `ShelfChanged`. Unlistens on unmount so a closed panel
 * costs nothing (PRD performance budget).
 */
export function useShelfSubscription(): void {
  const setSnapshot = useShelfStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.shelfChanged
      .listen((event) => {
        setSnapshot(event.payload.snapshot);
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      }, outsideTauri);
    void commands
      .getShelfSnapshot()
      .then((result) => {
        if (!disposed && result.status === 'ok') setSnapshot(result.data);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setSnapshot]);
}

/**
 * Sends a `ShelfCommand` and applies the snapshot it returns; the `ShelfChanged` that follows
 * says the same. A refused command (a blank snippet, ids that are gone) or running outside
 * Tauri leaves the store as it was.
 */
export function useShelfCommand(): (command: ShelfCommand) => Promise<boolean> {
  const setSnapshot = useShelfStore((store) => store.setSnapshot);
  return useCallback(
    (command: ShelfCommand) =>
      commands
        .shelfCommand(command)
        .then((result) => {
          if (result.status === 'ok') {
            setSnapshot(result.data);
            return true;
          }
          return false;
        })
        .catch(() => {
          // Outside Tauri (tests, Storybook) the seeded snapshot stands.
          return false;
        }),
    [setSnapshot],
  );
}

export const shelfThumbnailKey = (id: string) => ['shelf', 'thumbnail', id] as const;

/**
 * Explorer's thumbnail for a file item as a data URL, or `null` for a snippet, a missing file
 * or a file without a picture. Rust renders once and caches per item; TanStack Query keeps
 * the URL for as long as the tile is mounted, so a re-render never asks again.
 */
export function useShelfThumbnail(item: ShelfItem): string | null {
  const wanted = item.kind === 'file' && !item.missing;
  const query = useQuery({
    queryKey: shelfThumbnailKey(item.id),
    enabled: wanted,
    queryFn: async () => {
      const result = await commands.shelfThumbnail(item.id);
      return result.status === 'ok' ? result.data : null;
    },
  });
  return wanted ? (query.data ?? null) : null;
}
