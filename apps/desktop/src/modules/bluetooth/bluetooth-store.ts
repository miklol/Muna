import type { BluetoothSnapshot, IpcError } from '@muna/contracts';
import { create } from 'zustand';

/** A command in flight for one device, or `radio` for the switch. */
export type BluetoothPending = 'connect' | 'disconnect';

export interface BluetoothStore {
  /** Last `BluetoothChanged`; `null` until the first snapshot arrives. */
  snapshot: BluetoothSnapshot | null;
  /** Device id → the command still waiting on Windows (connecting pages the device). */
  pending: Readonly<Record<string, BluetoothPending>>;
  /** The radio switch is waiting on Windows. */
  radioPending: boolean;
  /** Device id → the refusal the last command met; cleared by the next attempt or a report. */
  errors: Readonly<Record<string, IpcError>>;
  radioError: IpcError | null;
  setSnapshot: (snapshot: BluetoothSnapshot) => void;
  begin: (id: string, command: BluetoothPending) => void;
  settle: (id: string, error: IpcError | null) => void;
  beginRadio: () => void;
  settleRadio: (error: IpcError | null) => void;
}

const without = <T>(record: Readonly<Record<string, T>>, id: string): Record<string, T> => {
  const { [id]: _dropped, ...rest } = record;
  return rest;
};

/**
 * The Bluetooth module's mirror of the Rust service (docs/modules/bluetooth.md). Fed by
 * `useBluetoothSubscription` while the panel or the settings pane is mounted; the strip never
 * needs it because notices arrive through `StripContentChanged`. Nothing here polls.
 */
export const useBluetoothStore = create<BluetoothStore>()((set) => ({
  snapshot: null,
  pending: {},
  radioPending: false,
  errors: {},
  radioError: null,
  setSnapshot: (snapshot) => {
    set((state) => {
      // A device that reports itself again has moved on from whatever refused it.
      const errors = Object.fromEntries(
        Object.entries(state.errors).filter(([id]) => {
          const before = state.snapshot?.devices.find((device) => device.id === id);
          const after = snapshot.devices.find((device) => device.id === id);
          return after !== undefined && before?.connected === after.connected;
        }),
      );
      return { snapshot, errors };
    });
  },
  begin: (id, command) => {
    set((state) => ({
      pending: { ...state.pending, [id]: command },
      errors: without(state.errors, id),
    }));
  },
  settle: (id, error) => {
    set((state) => ({
      pending: without(state.pending, id),
      errors: error === null ? without(state.errors, id) : { ...state.errors, [id]: error },
    }));
  },
  beginRadio: () => {
    set({ radioPending: true, radioError: null });
  },
  settleRadio: (error) => {
    set({ radioPending: false, radioError: error });
  },
}));
