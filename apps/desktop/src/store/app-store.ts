import type { StripContent } from '@muna/contracts';
import { create } from 'zustand';

export interface AppStore {
  /** What the closed strip renders; mirrors the Rust scheduler via `StripContentChanged`. */
  stripContent: StripContent;
  setStripContent: (content: StripContent) => void;
}

export const useAppStore = create<AppStore>()((set) => ({
  stripContent: { kind: 'idle' },
  setStripContent: (content) => {
    set({ stripContent: content });
  },
}));
