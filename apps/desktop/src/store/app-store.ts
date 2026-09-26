import type { DropItem, DropPoint, ShellLayout, StripContent, YieldState } from '@muna/contracts';
import { create } from 'zustand';

/**
 * A drag carrying files over this window (docs/modules/drop-actions.md): what Rust told the
 * UI in `DropEntered`, then whether the items were released. The pointer position lives apart
 * so that a drag moving across the tiles re-renders the row alone.
 */
export interface DropSession {
  readonly session: number;
  readonly items: readonly DropItem[];
  /** `true` once `Dropped` arrived: the row hit-tests `dropPosition` and runs the action. */
  readonly dropped: boolean;
}

/**
 * A tracked window drag (docs/modules/window-snap.md) as this window sees it: it exists from
 * the first `SnapDragMoved` over this window and ends with `SnapDragEnded`, which every window
 * receives — `endedOver` names the one whose zones (if any) get to place the window.
 */
export interface SnapSession {
  readonly session: number;
  /** `true` once `SnapDragEnded` arrived. */
  readonly ended: boolean;
  /** The notch window the cursor was over when the drag ended; `null` for none. */
  readonly endedOver: string | null;
}

export interface AppStore {
  /** What the closed strip renders; mirrors the Rust scheduler via `StripContentChanged`. */
  stripContent: StripContent;
  /** `Date.now()` when `stripContent` arrived; countdowns in the strip tick from here. */
  stripContentAt: number;
  setStripContent: (content: StripContent, at?: number) => void;
  /** Placement of this notch window; `null` until the shell has attached it. */
  shellLayout: ShellLayout | null;
  setShellLayout: (layout: ShellLayout | null) => void;
  /** What the yield rules ask of this window (`ShellYieldChanged`). */
  yieldState: YieldState;
  setYieldState: (state: YieldState) => void;
  /** The module the panel shows; `null` falls back to the first module in order. */
  activeModuleId: string | null;
  setActiveModule: (id: string | null) => void;
  /** The drag over this window, if any (`DropEntered` … `DropLeft` / handled). */
  dropSession: DropSession | null;
  /** Where the drag's pointer is, in this window's CSS px; `null` between drags. */
  dropPosition: DropPoint | null;
  /** `DropEntered`: a new drag; replaces any session the UI still held. */
  beginDrop: (session: number, items: readonly DropItem[], position: DropPoint) => void;
  /** `DropMoved`: ignored unless it names the current session. */
  moveDrop: (session: number, position: DropPoint) => void;
  /** `Dropped`: the items were released at `position`. */
  markDropped: (session: number, position: DropPoint) => void;
  /** `DropLeft`, or the row has handled the drop: forgets the session. */
  endDrop: (session: number) => void;
  /** The window drag this window knows about, if any (`SnapDragMoved` … `SnapDragEnded`). */
  snapSession: SnapSession | null;
  /** Where the drag's cursor is over this window, in CSS px; `null` while it is elsewhere. */
  snapPosition: DropPoint | null;
  /** `SnapDragMoved`: the cursor is over this window; a new session replaces the old one. */
  moveSnap: (session: number, position: DropPoint) => void;
  /** `SnapDragLeft`: the cursor left this window; the session stays until the drag ends. */
  leaveSnap: (session: number) => void;
  /** `SnapDragEnded`: the button went up over `endedOver` (`null` for no notch window). */
  markSnapEnded: (session: number, endedOver: string | null) => void;
  /** The zones have applied or cancelled, or the drag was somebody else's: forgets the session. */
  endSnap: (session: number) => void;
}

/** `ShellLayout` is flat and primitive-valued, so a key-by-key comparison is exact. */
const sameLayout = (a: ShellLayout, b: ShellLayout): boolean =>
  (Object.keys(a) as (keyof ShellLayout)[]).every((key) => a[key] === b[key]) &&
  Object.keys(a).length === Object.keys(b).length;

export const useAppStore = create<AppStore>()((set, get) => ({
  stripContent: { kind: 'idle' },
  stripContentAt: 0,
  setStripContent: (content, at = Date.now()) => {
    set({ stripContent: content, stripContentAt: at });
  },
  shellLayout: null,
  setShellLayout: (layout) => {
    // The shell re-sends the layout with every `shellReady`; an unchanged one must not
    // re-render the window (each render costs a new geometry and new published rects).
    const { shellLayout: current, yieldState } = get();
    if (
      layout !== null &&
      current !== null &&
      sameLayout(layout, current) &&
      yieldState === layout.yieldState
    ) {
      return;
    }
    set(layout ? { shellLayout: layout, yieldState: layout.yieldState } : { shellLayout: null });
  },
  yieldState: 'none',
  setYieldState: (state) => {
    set({ yieldState: state });
  },
  activeModuleId: null,
  setActiveModule: (id) => {
    set({ activeModuleId: id });
  },
  dropSession: null,
  dropPosition: null,
  beginDrop: (session, items, position) => {
    set({ dropSession: { session, items, dropped: false }, dropPosition: position });
  },
  moveDrop: (session, position) => {
    const current = get().dropSession;
    if (current !== null && current.session === session) {
      set({ dropPosition: position });
    }
  },
  markDropped: (session, position) => {
    const current = get().dropSession;
    if (current !== null && current.session === session && !current.dropped) {
      set({ dropSession: { ...current, dropped: true }, dropPosition: position });
    }
  },
  endDrop: (session) => {
    const current = get().dropSession;
    if (current !== null && current.session === session) {
      set({ dropSession: null, dropPosition: null });
    }
  },
  snapSession: null,
  snapPosition: null,
  moveSnap: (session, position) => {
    const current = get().snapSession;
    if (current?.session !== session) {
      set({ snapSession: { session, ended: false, endedOver: null }, snapPosition: position });
    } else if (!current.ended) {
      set({ snapPosition: position });
    }
  },
  leaveSnap: (session) => {
    const current = get().snapSession;
    if (current !== null && current.session === session && !current.ended) {
      set({ snapPosition: null });
    }
  },
  markSnapEnded: (session, endedOver) => {
    const current = get().snapSession;
    if (current?.session !== session) {
      // A drag that never came over this window still ends here: the zones were never shown,
      // so there is nothing to collapse and nothing to forget.
      return;
    }
    if (!current.ended) {
      set({ snapSession: { ...current, ended: true, endedOver } });
    }
  },
  endSnap: (session) => {
    const current = get().snapSession;
    if (current !== null && current.session === session) {
      set({ snapSession: null, snapPosition: null });
    }
  },
}));
