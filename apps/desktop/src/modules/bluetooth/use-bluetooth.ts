import { type BluetoothCommand, commands, events, type IpcError } from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useBluetoothStore } from './bluetooth-store';

/**
 * Mirrors the Rust Bluetooth service into `useBluetoothStore` while the caller is mounted: one
 * `get_bluetooth_snapshot` round trip, then `BluetoothChanged`. Unlistens on unmount so a
 * closed panel costs nothing (PRD performance budget).
 */
export function useBluetoothSubscription(): void {
  const setSnapshot = useBluetoothStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.bluetoothChanged
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
      .getBluetoothSnapshot()
      .then((snapshot) => {
        if (!disposed) setSnapshot(snapshot);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setSnapshot]);
}

const isIpcError = (value: unknown): value is IpcError =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  typeof value.code === 'string' &&
  'message' in value &&
  typeof value.message === 'string';

/**
 * Sends a `BluetoothCommand`, marks the device (or the radio) pending until Windows answers,
 * and keeps the refusal beside the row when it says no. The snapshot the command returns is
 * applied; the `BluetoothChanged` that follows says the same.
 */
export function useBluetoothCommand(): (command: BluetoothCommand) => void {
  const { setSnapshot, begin, settle, beginRadio, settleRadio } = useBluetoothStore.getState();
  return useCallback(
    (command: BluetoothCommand) => {
      const done = (error: IpcError | null) => {
        if (command.kind === 'setRadio') {
          settleRadio(error);
        } else {
          settle(command.id, error);
        }
      };
      if (command.kind === 'setRadio') {
        beginRadio();
      } else {
        begin(command.id, command.kind);
      }
      void commands
        .bluetoothCommand(command)
        .then((result) => {
          if (result.status === 'ok') {
            setSnapshot(result.data);
            done(null);
          } else {
            done(result.error);
          }
        })
        .catch((reason: unknown) => {
          // Outside Tauri (tests, Storybook) the seeded snapshot stands and nothing is pending.
          done(isIpcError(reason) ? reason : null);
        });
    },
    [setSnapshot, begin, settle, beginRadio, settleRadio],
  );
}
