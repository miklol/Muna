import { Text } from '@muna/ui';
import { CloudOff, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { conditionKey, formatDegrees } from './format';
import { placeLabel } from './panel';
import { useWeatherSubscription } from './use-weather';
import { ConditionIcon } from './weather-icon';
import { useWeatherStore } from './weather-store';
import './weather.css';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/**
 * The weather card on the dashboard (docs/modules/dashboard.md "Widgets": Weather card): the
 * condition glyph, the temperature, the condition and today's high and low; a wide card adds
 * the place. Off, waiting for a location or loading, it says so in one line.
 */
export function WeatherWidget({ span }: WidgetProps) {
  const { t, i18n } = useTranslation();
  useWeatherSubscription();
  const snapshot = useWeatherStore((store) => store.snapshot);
  const locale = i18n.resolvedLanguage ?? i18n.language;

  if (snapshot === null) return null;

  const { forecast, location } = snapshot;

  if (!snapshot.enabled || forecast === null) {
    const needsCity =
      location.kind === 'auto' &&
      (location.status === 'denied' || location.status === 'unavailable');
    let text: string;
    if (!snapshot.enabled) {
      text = t('weather.off.title');
    } else if (needsCity) {
      text = t('weather.chooseCity.title');
    } else if (snapshot.error !== null && !snapshot.fetching) {
      text = t(`weather.error.${snapshot.error}.title`);
    } else if (location.kind === 'auto' && location.status === 'resolving') {
      text = t('weather.locating.title');
    } else {
      text = t('weather.loading');
    }
    return (
      <div className="weather-widget" data-empty>
        <span className="weather-widget__glyph">
          {needsCity ? (
            <MapPin strokeWidth={ICON_STROKE} />
          ) : (
            <CloudOff strokeWidth={ICON_STROKE} />
          )}
        </span>
        <Text as="p" variant="footnote" tone="secondary" className="weather-widget__note">
          {text}
        </Text>
      </div>
    );
  }

  const { current } = forecast;
  const today = forecast.daily[0];
  const degrees = (celsius: number) => formatDegrees(celsius, snapshot.units, locale);
  return (
    <div className="weather-widget">
      <span className="weather-widget__glyph">
        <ConditionIcon
          condition={current.condition}
          isDay={current.isDay}
          size={span === 2 ? 40 : 32}
          strokeWidth={1.5}
        />
      </span>
      <div className="weather-widget__text">
        <Text as="span" variant="title2" tabular className="weather-widget__temp">
          {degrees(current.temperatureC)}
        </Text>
        <Text as="span" variant="caption" tone="secondary" truncate={1}>
          {t(conditionKey[current.condition])}
        </Text>
        {today !== undefined && (
          <Text as="span" variant="caption" tone="tertiary" tabular truncate={1}>
            {t('weather.high', { value: degrees(today.highC) })}
            {' · '}
            {t('weather.low', { value: degrees(today.lowC) })}
          </Text>
        )}
      </div>
      {span === 2 && (
        <Text
          as="span"
          variant="caption"
          tone="secondary"
          truncate={1}
          className="weather-widget__place"
        >
          {placeLabel(location, t)}
        </Text>
      )}
    </div>
  );
}
