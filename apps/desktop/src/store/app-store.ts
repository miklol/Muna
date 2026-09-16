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
  /** The module the panel shows; `null` falls back to the first module in order. */
  activeModuleId: string | null;
  setActiveModule: (id: string | null) => void;
  /** Module ids in bar order; ids the registry does not know are ignored, new modules append. */
  moduleOrder: readonly string[];
  setModuleOrder: (ids: readonly string[]) => void;
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
  activeModuleId: null,
  setActiveModule: (id) => {
    set({ activeModuleId: id });
  },
  moduleOrder: [],
  setModuleOrder: (ids) => {
    set({ moduleOrder: ids });
  },
}));
