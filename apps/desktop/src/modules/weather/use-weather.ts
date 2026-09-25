import { commands, events, type IpcError, type Place, type WeatherCommand } from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useWeatherStore } from './weather-store';

/**
 * Mirrors the Rust weather service into `useWeatherStore` while the caller is mounted: one
 * `get_weather_snapshot` round trip, then `WeatherChanged`. Unlistens on unmount so a closed
 * panel costs nothing (PRD performance budget).
 */
export function useWeatherSubscription(): void {
  const setSnapshot = useWeatherStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.weatherChanged
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
      .getWeatherSnapshot()
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
 * Sends a `WeatherCommand` and applies the snapshot it returns; the `WeatherChanged` events
 * that follow (fetching, then the forecast) say the rest.
 */
export function useWeatherCommand(): (command: WeatherCommand) => void {
  const setSnapshot = useWeatherStore((store) => store.setSnapshot);
  return useCallback(
    (command: WeatherCommand) => {
      void commands
        .weatherCommand(command)
        .then(setSnapshot)
        .catch(() => {
          // Outside Tauri (tests, Storybook) the seeded snapshot stands.
        });
    },
    [setSnapshot],
  );
}

/** Why a city search returned nothing, by the IPC error code the Rust side maps to. */
export type SearchFailure = 'disabled' | 'offline' | 'provider';

export type SearchOutcome =
  { status: 'ok'; places: Place[] } | { status: 'error'; failure: SearchFailure };

const failureOf = (error: IpcError): SearchFailure => {
  switch (error.code) {
    case 'weather.disabled':
      return 'disabled';
    case 'weather.offline':
      return 'offline';
    default:
      return 'provider';
  }
};

/**
 * Asks the geocoder for places matching a typed name. The Rust side refuses while the module
 * is off, so the settings pane cannot cause a request before the switch is on.
 */
export async function searchPlaces(query: string): Promise<SearchOutcome> {
  try {
    const result = await commands.weatherSearch(query);
    return result.status === 'ok'
      ? { status: 'ok', places: result.data }
      : { status: 'error', failure: failureOf(result.error) };
  } catch {
    // Outside Tauri (tests, Storybook) there is no geocoder.
    return { status: 'error', failure: 'provider' };
  }
}
