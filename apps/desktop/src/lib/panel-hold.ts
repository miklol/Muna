/**
 * A module's hold on the panel (docs/modules/notch-shell.md "a guided flow runs"): while any
 * hold is out the shell pins the panel — no auto-collapse, no click-outside close — without
 * the pin button lighting up. Esc, the ⤡ button and the hotkey still close. Modules take a
 * hold with `usePanelHold`; the shell watches `useIsPanelHeld` and tells the machine.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

interface PanelHoldState {
  /** Holds out right now; the panel is held while it is above zero. */
  readonly holds: number;
  /** Takes a hold; the returned function releases it (once). */
  readonly acquire: () => () => void;
}

export const usePanelHoldStore = create<PanelHoldState>((set) => ({
  holds: 0,
  acquire: () => {
    let released = false;
    set((state) => ({ holds: state.holds + 1 }));
    return () => {
      if (released) {
        return;
      }
      released = true;
      set((state) => ({ holds: Math.max(0, state.holds - 1) }));
    };
  },
}));

/** Holds the panel open while `active`; the hold goes when `active` turns false or on unmount. */
export const usePanelHold = (active: boolean): void => {
  const acquire = usePanelHoldStore((state) => state.acquire);
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    return acquire();
  }, [active, acquire]);
};

/** Whether any module holds the panel right now. */
export const useIsPanelHeld = (): boolean => usePanelHoldStore((state) => state.holds > 0);
