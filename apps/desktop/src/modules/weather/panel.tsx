import type { AutoLocationStatus, Forecast, LocationView, WeatherSnapshot } from '@muna/contracts';
import type { MessageKey, Translate } from '@muna/i18n';
import {
  Button,
  Chip,
  contentRecipe,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { commands } from '@muna/contracts';
import {
  CloudOff,
  Droplets,
  Gauge,
  MapPin,
  Navigation,
  RefreshCw,
  Sun,
  Sunrise,
  Sunset,
  Wind,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import {
  conditionKey,
  formatDegrees,
  formatHour,
  formatNumber,
  formatPercent,
  formatSpeed,
  formatUpdated,
  formatWallTime,
  formatWeekday,
  skyOf,
} from './format';
import { useWeatherCommand, useWeatherSubscription } from './use-weather';
import { ConditionIcon } from './weather-icon';
import { useWeatherStore } from './weather-store';
import './weather.css';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The hourly strip shows the next twelve hours (docs/modules/weather.md "Reference"). */
export const HOURS_SHOWN = 12;

/** The daily strip shows a week. */
export const DAYS_SHOWN = 7;

/** The line under the place: the city, or what Windows is doing about the location. */
export const placeLabel = (location: LocationView, t: Translate): string =>
  location.kind === 'manual' ? location.place.name : t('weather.currentLocation');

const deniedBody: Record<Exclude<AutoLocationStatus, 'resolving' | 'ready'>, MessageKey> = {
  denied: 'weather.chooseCity.denied',
  unavailable: 'weather.chooseCity.unavailable',
  failed: 'weather.chooseCity.failed',
};

const openSettings = () => {
  void commands.openSettings().catch(() => {
    // Outside Tauri (tests, Storybook) there is no settings window.
  });
};

interface LoadingProps {
  label: string;
}

/** The forecast's silhouette while the first one loads; never shown once a forecast exists. */
function Loading({ label }: LoadingProps) {
  return (
    <div className="weather-loading" role="status" aria-label={label}>
      <div className="weather-now">
        <Skeleton shape="circle" width={44} height={44} />
        <Skeleton shape="text" width={72} height={34} />
        <div className="weather-now__text">
          <Skeleton shape="text" width={96} height={12} />
          <Skeleton shape="text" width={72} height={11} />
        </div>
      </div>
      <div className="weather-strip" aria-hidden>
        {Array.from({ length: HOURS_SHOWN }, (_, index) => (
          <Skeleton key={index} shape="block" width={40} height={48} />
        ))}
      </div>
    </div>
  );
}

interface ForecastViewProps {
  snapshot: WeatherSnapshot;
  forecast: Forecast;
  onRefresh: () => void;
}

/**
 * The forecast: the moment now on top (glyph, temperature, condition, high and low, feels
 * like), the day's readings as chips, the next twelve hours, then the week. When the last
 * refresh failed the forecast stays and a chip says when it was fetched (acceptance criterion
 * "offline → last forecast with a timestamp chip").
 */
function ForecastView({ snapshot, forecast, onRefresh }: ForecastViewProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { units } = snapshot;
  const { current } = forecast;
  const today = forecast.daily[0];
  const hours = forecast.hourly.slice(0, HOURS_SHOWN);
  const days = forecast.daily.slice(0, DAYS_SHOWN);
  const degrees = (celsius: number) => formatDegrees(celsius, units, locale);
  const stale = snapshot.error !== null && snapshot.fetchedAtMs !== null;

  return (
    <>
      <div className="weather-now">
        <span className="weather-now__glyph">
          <ConditionIcon
            condition={current.condition}
            isDay={current.isDay}
            size={44}
            strokeWidth={1.5}
          />
        </span>
        <Text as="span" variant="display" tabular className="weather-now__temp">
          {degrees(current.temperatureC)}
        </Text>
        <div className="weather-now__text">
          <Text as="span" variant="footnote" className="weather-now__condition">
            {t(conditionKey[current.condition])}
          </Text>
          {today !== undefined && (
            <Text as="span" variant="caption" tone="tertiary" tabular>
              {t('weather.high', { value: degrees(today.highC) })}
              {' · '}
              {t('weather.low', { value: degrees(today.lowC) })}
            </Text>
          )}
          <Text as="span" variant="caption" tone="tertiary" tabular>
            {t('weather.feelsLike', { value: degrees(current.apparentTemperatureC) })}
          </Text>
        </div>
        <div className="weather-now__aside">
          <Text
            as="span"
            variant="caption"
            tone="secondary"
            truncate={1}
            className="weather-now__place"
          >
            {snapshot.location.kind === 'manual' ? (
              <MapPin size={12} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
            ) : (
              <Navigation size={12} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
            )}
            {placeLabel(snapshot.location, t)}
          </Text>
          <span className="weather-now__actions">
            {stale && snapshot.fetchedAtMs !== null && (
              <Chip icon={<CloudOff strokeWidth={ICON_STROKE} />}>
                {t('weather.updated', { time: formatUpdated(snapshot.fetchedAtMs, locale) })}
              </Chip>
            )}
            <IconButton
              aria-label={snapshot.fetching ? t('weather.refreshing') : t('weather.refresh')}
              isDisabled={snapshot.fetching}
              onPress={onRefresh}
            >
              <RefreshCw strokeWidth={ICON_STROKE} />
            </IconButton>
          </span>
        </div>
      </div>

      <ul className="weather-chips" aria-label={t('weather.today')}>
        <li>
          <Chip icon={<Droplets strokeWidth={ICON_STROKE} />}>
            <span className="weather-chip__label">{t('weather.humidity')}</span>
            {formatPercent(current.humidityPercent, locale)}
          </Chip>
        </li>
        <li>
          <Chip icon={<Wind strokeWidth={ICON_STROKE} />}>
            <span className="weather-chip__label">{t('weather.wind')}</span>
            {formatSpeed(current.windKmh, units, locale)}
          </Chip>
        </li>
        {current.uvIndex !== null && (
          <li>
            <Chip icon={<Sun strokeWidth={ICON_STROKE} />}>
              <span className="weather-chip__label">{t('weather.uv')}</span>
              {formatNumber(current.uvIndex, locale)}
            </Chip>
          </li>
        )}
        <li>
          <Chip icon={<Gauge strokeWidth={ICON_STROKE} />}>
            <span className="weather-chip__label">{t('weather.pressure')}</span>
            {t('weather.hpa', { value: formatNumber(current.pressureHpa, locale) })}
          </Chip>
        </li>
        {today !== undefined && (
          <>
            <li>
              <Chip icon={<Sunrise strokeWidth={ICON_STROKE} />}>
                <span className="weather-chip__label">{t('weather.sunrise')}</span>
                {formatWallTime(today.sunrise, locale)}
              </Chip>
            </li>
            <li>
              <Chip icon={<Sunset strokeWidth={ICON_STROKE} />}>
                <span className="weather-chip__label">{t('weather.sunset')}</span>
                {formatWallTime(today.sunset, locale)}
              </Chip>
            </li>
          </>
        )}
      </ul>

      <ol className="weather-strip weather-hourly" aria-label={t('weather.hourly')}>
        {hours.map((hour, index) => (
          <li key={hour.time} className="weather-cell">
            <Text as="span" variant="caption2" tone="tertiary" tabular>
              {index === 0 ? t('weather.now') : formatHour(hour.time, locale)}
            </Text>
            <ConditionIcon
              condition={hour.condition}
              isDay={hour.isDay}
              size={16}
              strokeWidth={ICON_STROKE}
            />
            <Text as="span" variant="footnote" tabular>
              {degrees(hour.temperatureC)}
            </Text>
            <Text
              as="span"
              variant="caption2"
              tone="tertiary"
              tabular
              className="weather-cell__chance"
              aria-label={
                hour.precipitationPercent === null
                  ? undefined
                  : t('weather.chance', { value: formatPercent(hour.precipitationPercent, locale) })
              }
            >
              {hour.precipitationPercent === null || hour.precipitationPercent < 10
                ? '\u00a0'
                : formatPercent(hour.precipitationPercent, locale)}
            </Text>
          </li>
        ))}
      </ol>

      <ol className="weather-strip weather-daily" aria-label={t('weather.daily')}>
        {days.map((day, index) => (
          <li key={day.date} className="weather-cell">
            <Text as="span" variant="caption2" tone="tertiary">
              {index === 0 ? t('weather.today') : formatWeekday(day.date, locale)}
            </Text>
            <ConditionIcon condition={day.condition} isDay size={16} strokeWidth={ICON_STROKE} />
            <Text as="span" variant="footnote" tabular>
              {degrees(day.highC)}
            </Text>
            <Text as="span" variant="caption2" tone="tertiary" tabular>
              {degrees(day.lowC)}
            </Text>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * The weather panel (docs/modules/weather.md). Off by default: the first thing a new user
 * sees is a plain invitation to turn it on, and nothing leaves the PC until they do. While on,
 * the panel mirrors the Rust service — locating, loading, the forecast, or why there is none —
 * and the sky behind it follows the condition and the hour. The panel keeps no timers; the
 * refresh clock is Rust's.
 */
export function WeatherPanel() {
  const { t } = useTranslation();
  useWeatherSubscription();
  const snapshot = useWeatherStore((store) => store.snapshot);
  const send = useWeatherCommand();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');

  if (snapshot === null) return null;

  const refresh = () => {
    send({ kind: 'refresh' });
  };
  const retryLocation = () => {
    send({ kind: 'retryLocation' });
  };

  let sky: string | undefined;
  let body: ReactNode;
  const { forecast, location } = snapshot;

  if (!snapshot.enabled) {
    body = (
      <EmptyState
        className="weather-empty"
        icon={<CloudOff size={24} strokeWidth={1.5} />}
        title={t('weather.off.title')}
        description={t('weather.off.body')}
        action={
          <Button variant="secondary" onPress={openSettings}>
            {t('weather.off.action')}
          </Button>
        }
      />
    );
  } else if (forecast !== null) {
    sky = skyOf(forecast.current.condition, forecast.current.isDay);
    body = <ForecastView snapshot={snapshot} forecast={forecast} onRefresh={refresh} />;
  } else if (
    location.kind === 'auto' &&
    (location.status === 'denied' || location.status === 'unavailable')
  ) {
    body = (
      <EmptyState
        className="weather-empty"
        icon={<MapPin size={24} strokeWidth={1.5} />}
        title={t('weather.chooseCity.title')}
        description={t(deniedBody[location.status])}
        action={
          <span className="weather-empty__actions">
            <Button variant="primary" onPress={openSettings}>
              {t('weather.chooseCity.action')}
            </Button>
            {location.status === 'denied' && (
              <Button variant="secondary" onPress={retryLocation}>
                {t('weather.chooseCity.retry')}
              </Button>
            )}
          </span>
        }
      />
    );
  } else if (location.kind === 'auto' && location.status === 'failed') {
    body = (
      <EmptyState
        className="weather-empty"
        icon={<Navigation size={24} strokeWidth={1.5} />}
        title={t('weather.locating.title')}
        description={t(deniedBody.failed)}
        action={
          <Button variant="secondary" onPress={retryLocation}>
            {t('weather.chooseCity.retry')}
          </Button>
        }
      />
    );
  } else if (snapshot.error !== null && !snapshot.fetching) {
    body = (
      <ErrorState
        className="weather-empty"
        icon={<CloudOff size={24} strokeWidth={1.5} />}
        title={t(`weather.error.${snapshot.error}.title`)}
        description={t(`weather.error.${snapshot.error}.body`)}
        retryLabel={t('weather.error.retry')}
        onRetry={refresh}
      />
    );
  } else {
    body = (
      <Loading
        label={
          location.kind === 'auto' && location.status === 'resolving'
            ? t('weather.locating.title')
            : t('weather.loading')
        }
      />
    );
  }

  return (
    <motion.div
      className="weather-panel"
      data-sky={sky}
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      {body}
    </motion.div>
  );
}
