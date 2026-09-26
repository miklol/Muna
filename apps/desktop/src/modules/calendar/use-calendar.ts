import {
  type CalendarCommand,
  commands,
  events,
  type IpcError,
  type Settings,
  type SourceSetting,
  type Tint,
} from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useCalendarStore } from './calendar-store';

/**
 * Mirrors the Rust calendar service into `useCalendarStore` while the caller is mounted: one
 * `get_calendar_snapshot` round trip, then `CalendarChanged`. Unlistens on unmount so a closed
 * panel costs nothing (PRD performance budget).
 */
export function useCalendarSubscription(): void {
  const setSnapshot = useCalendarStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.calendarChanged
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
      .getCalendarSnapshot()
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

/**
 * Sends a `CalendarCommand` and applies the snapshot it returns; the `CalendarChanged` events
 * that follow (each source fetching, then its events) say the rest.
 */
export function useCalendarCommand(): (command: CalendarCommand) => void {
  const setSnapshot = useCalendarStore((store) => store.setSnapshot);
  return useCallback(
    (command: CalendarCommand) => {
      void commands
        .calendarCommand(command)
        .then(setSnapshot)
        .catch(() => {
          // Outside Tauri (tests, Storybook) the seeded snapshot stands.
        });
    },
    [setSnapshot],
  );
}

/** Why a subscription was refused, by the IPC error code the Rust side maps to. */
export type AddFailure = 'malformed' | 'scheme' | 'credentials' | 'vault' | 'failed';

export type AddOutcome =
  { status: 'ok'; source: SourceSetting } | { status: 'error'; failure: AddFailure };

const addFailureOf = (error: IpcError): AddFailure => {
  switch (error.code) {
    case 'calendar.url.malformed':
      return 'malformed';
    case 'calendar.url.scheme':
      return 'scheme';
    case 'calendar.url.credentials':
      return 'credentials';
    case 'calendar.vault':
      return 'vault';
    default:
      return 'failed';
  }
};

/**
 * Subscribes to a feed. The address goes to Rust once and stays in the credential vault; the
 * settings document only ever holds the name, colour and host, and Rust saves and broadcasts
 * it before answering.
 */
export async function addSource(name: string, url: string, color: Tint): Promise<AddOutcome> {
  try {
    const result = await commands.calendarAddSource(name, url, color);
    return result.status === 'ok'
      ? { status: 'ok', source: result.data }
      : { status: 'error', failure: addFailureOf(result.error) };
  } catch {
    // Outside Tauri (tests, Storybook) there is no vault.
    return { status: 'error', failure: 'failed' };
  }
}

/** Forgets a source, its vault entry and its cache; answers the settings Rust saved. */
export async function removeSource(id: string): Promise<Settings | null> {
  try {
    const result = await commands.calendarRemoveSource(id);
    return result.status === 'ok' ? result.data : null;
  } catch {
    return null;
  }
}

export type OpenOutcome = 'opened' | 'noLink' | 'failed';

/** Opens an event's meeting link or URL in the default handler, through Rust. */
export async function openEvent(eventId: string): Promise<OpenOutcome> {
  try {
    const result = await commands.calendarOpen(eventId);
    if (result.status === 'ok') return 'opened';
    return result.error.code === 'calendar.noLink' ? 'noLink' : 'failed';
  } catch {
    return 'failed';
  }
}
