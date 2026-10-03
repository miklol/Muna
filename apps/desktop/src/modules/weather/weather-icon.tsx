import type { WeatherCondition } from '@muna/contracts';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Moon,
  Sun,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `CloudSun` at whatever size the shell asks for. */
export function WeatherIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <CloudSun size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}

type LucideIcon = ComponentType<{
  size?: number;
  strokeWidth?: number;
  'aria-hidden'?: boolean;
  focusable?: boolean;
}>;

interface DayNight {
  day: LucideIcon;
  night: LucideIcon;
}

/** The glyph for each condition, by day and by night (docs/modules/weather.md "Visual"). */
const CONDITION_ICONS: Record<WeatherCondition, DayNight> = {
  clear: { day: Sun, night: Moon },
  mainlyClear: { day: Sun, night: Moon },
  partlyCloudy: { day: CloudSun, night: CloudMoon },
  overcast: { day: Cloud, night: Cloud },
  fog: { day: CloudFog, night: CloudFog },
  drizzle: { day: CloudDrizzle, night: CloudDrizzle },
  rain: { day: CloudRain, night: CloudRain },
  snow: { day: CloudSnow, night: CloudSnow },
  showers: { day: CloudSunRain, night: CloudMoonRain },
  snowShowers: { day: CloudSnow, night: CloudSnow },
  thunderstorm: { day: CloudLightning, night: CloudLightning },
  unknown: { day: Cloud, night: Cloud },
};

interface ConditionIconProps {
  condition: WeatherCondition;
  isDay: boolean;
  size?: number;
  strokeWidth?: number;
}

/** A condition's glyph; the sun becomes a moon after sunset. */
export function ConditionIcon({
  condition,
  isDay,
  size = 20,
  strokeWidth = 1.5,
}: ConditionIconProps) {
  const icons = CONDITION_ICONS[condition];
  const Icon = isDay ? icons.day : icons.night;
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
