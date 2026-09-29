import type { ShellLayout, StripContent, YieldState } from '@muna/contracts';
import { create } from 'zustand';

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
}));
