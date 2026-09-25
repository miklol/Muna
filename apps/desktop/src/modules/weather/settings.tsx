import {
  type Place,
  readWeatherSettings,
  type Units,
  type WeatherSettings,
  writeWeatherSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { ListRow, type SegmentedControlItem, Text, TextField } from '@muna/ui';
import { MapPin, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Section, SegmentedRow, ToggleRow, ValueRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { type SearchFailure, searchPlaces } from './use-weather';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

type LocationKind = WeatherSettings['location']['kind'];

/** The parts the geocoder knows, joined: `Paris, Île-de-France, France`. */
export const describePlace = (place: Place, locale: string): string =>
  joinParts([place.name, place.region, place.country], locale);

/** The second line of a search result: what tells two places of the same name apart. */
export const describeRegion = (place: Place, locale: string): string | undefined => {
  const text = joinParts([place.region, place.country], locale);
  return text === '' ? undefined : text;
};

const joinParts = (parts: readonly (string | null)[], locale: string): string =>
  new Intl.ListFormat(locale, { type: 'unit', style: 'short' }).format(
    parts.filter((part): part is string => part !== null && part !== ''),
  );

const failureKey: Record<SearchFailure, MessageKey> = {
  disabled: 'weather.settings.searchOff',
  offline: 'weather.settings.searchOffline',
  provider: 'weather.settings.searchFailed',
};

type SearchState =
  | { phase: 'idle' }
  | { phase: 'searching' }
  | { phase: 'results'; places: Place[] }
  | { phase: 'failed'; failure: SearchFailure };

interface CitySearchProps {
  enabled: boolean;
  onChoose: (place: Place) => void;
}

/**
 * The city picker: a field that searches on Enter, then a short list of matches to press. The
 * geocoder is asked only when the user submits, never on every keystroke, and the Rust side
 * refuses while the module is off, which the pane says plainly instead of failing.
 */
export function CitySearch({ enabled, onChoose }: CitySearchProps) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<SearchState>({ phase: 'idle' });
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const search = (query: string) => {
    if (!enabled) {
      setState({ phase: 'failed', failure: 'disabled' });
      return;
    }
    setState({ phase: 'searching' });
    void searchPlaces(query).then((outcome) => {
      setState(
        outcome.status === 'ok'
          ? { phase: 'results', places: outcome.places }
          : { phase: 'failed', failure: outcome.failure },
      );
    });
  };

  let feedback: string | null = null;
  if (state.phase === 'searching') feedback = t('weather.settings.searching');
  else if (state.phase === 'failed') feedback = t(failureKey[state.failure]);
  else if (state.phase === 'results' && state.places.length === 0) {
    feedback = t('weather.settings.noResults');
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <TextField
        aria-label={t('weather.settings.search')}
        placeholder={t('weather.settings.searchPlaceholder')}
        leading={<Search size={16} strokeWidth={1.75} aria-hidden focusable={false} />}
        onSubmit={search}
      />
      {feedback !== null && (
        <Text as="p" variant="footnote" tone="secondary" role="status">
          {feedback}
        </Text>
      )}
      {state.phase === 'results' && state.places.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0" aria-label={t('weather.settings.search')}>
          {state.places.map((place) => (
            <li key={`${place.name}:${String(place.latitude)}:${String(place.longitude)}`}>
              <ListRow
                icon={<MapPin size={16} strokeWidth={1.75} aria-hidden focusable={false} />}
                label={place.name}
                description={describeRegion(place, locale)}
                aria-label={t('weather.settings.choosePlace', {
                  name: describePlace(place, locale),
                })}
                onPress={() => {
                  setState({ phase: 'idle' });
                  onChoose(place);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Settings → Weather (docs/modules/weather.md): the switch that lets the module make any
 * request at all, where the forecast is for, and how it reads. The pane leads with what leaves
 * the PC, because that is the decision the switch really is.
 */
export function WeatherSettingsPane() {
  const { t, i18n } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const weather = readWeatherSettings(settings);
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const write = (recipe: (current: WeatherSettings) => WeatherSettings) => {
    update((current) => writeWeatherSettings(current, recipe(readWeatherSettings(current))));
  };

  const locationItems: readonly SegmentedControlItem<LocationKind>[] = [
    { id: 'auto', label: t('weather.settings.useCurrent') },
    { id: 'manual', label: t('weather.settings.useCity') },
  ];
  const unitItems: readonly SegmentedControlItem<Units>[] = [
    { id: 'metric', label: t('weather.settings.metric') },
    { id: 'imperial', label: t('weather.settings.imperial') },
  ];

  // Switching to "City" before any city is chosen keeps the last place if there was one;
  // otherwise the setting stays `auto` until a search result is pressed, so a half-made choice
  // never writes coordinates that do not exist.
  const [wantsCity, setWantsCity] = useState(weather.location.kind === 'manual');
  const showCity = wantsCity || weather.location.kind === 'manual';

  const chosen = weather.location.kind === 'manual' ? weather.location.place : null;

  return (
    <Section
      title={t('weather.settings.section')}
      description={t('weather.settings.privacy')}
      visible={everything}
      rows={[
        {
          id: 'weather.enabled',
          node: (
            <ToggleRow
              label={t('weather.settings.show')}
              description={t('weather.settings.showBody')}
              isSelected={weather.enabled}
              onChange={(enabled) => {
                write((current) => ({ ...current, enabled }));
              }}
            />
          ),
        },
        {
          id: 'weather.location',
          node: (
            <SegmentedRow
              label={t('weather.settings.location')}
              description={t('weather.settings.locationBody')}
              items={locationItems}
              value={showCity ? 'manual' : 'auto'}
              onChange={(kind) => {
                setWantsCity(kind === 'manual');
                if (kind === 'auto') {
                  write((current) => ({ ...current, location: { kind: 'auto' } }));
                }
              }}
            />
          ),
        },
        ...(showCity
          ? [
              {
                id: 'weather.place',
                node: (
                  <ValueRow
                    label={t('weather.settings.place')}
                    value={
                      chosen === null
                        ? t('weather.settings.noPlace')
                        : describePlace(chosen, locale)
                    }
                  />
                ),
              },
              {
                id: 'weather.search',
                node: (
                  <CitySearch
                    enabled={weather.enabled}
                    onChoose={(place) => {
                      write((current) => ({ ...current, location: { kind: 'manual', place } }));
                    }}
                  />
                ),
              },
            ]
          : []),
        {
          id: 'weather.units',
          node: (
            <SegmentedRow
              label={t('weather.settings.units')}
              items={unitItems}
              value={weather.units}
              onChange={(units) => {
                write((current) => ({ ...current, units }));
              }}
            />
          ),
        },
      ]}
    />
  );
}
