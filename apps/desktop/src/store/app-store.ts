import type { ShellLayout, StripContent, YieldState } from '@muna/contracts';
import { create } from 'zustand';

export interface AppStore {
  /** What the closed strip renders; mirrors the Rust scheduler via `StripContentChanged`. */
  stripContent: StripContent;
  setStripContent: (content: StripContent) => void;
  /** Placement of this notch window; `null` until the shell has attached it. */
  shellLayout: ShellLayout | null;
  setShellLayout: (layout: ShellLayout | null) => void;
  /** What the yield rules ask of this window (`ShellYieldChanged`). */
  yieldState: YieldState;
  setYieldState: (state: YieldState) => void;
}

export const useAppStore = create<AppStore>()((set) => ({
  stripContent: { kind: 'idle' },
  setStripContent: (content) => {
    set({ stripContent: content });
  },
  shellLayout: null,
  setShellLayout: (layout) => {
    set(layout ? { shellLayout: layout, yieldState: layout.yieldState } : { shellLayout: null });
  },
  yieldState: 'none',
  setYieldState: (state) => {
    set({ yieldState: state });
  },
}));
