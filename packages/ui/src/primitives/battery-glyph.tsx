import type { ComponentPropsWithoutRef, CSSProperties } from 'react';

import './battery-glyph.css';
import { cx, type Tint, tintStyle } from './shared';

export interface BatteryGlyphProps extends Omit<ComponentPropsWithoutRef<'svg'>, 'children'> {
  /** 0–100. */
  percent: number;
  /** Adds the bolt and paints the fill green. */
  charging?: boolean;
  /** Outer size in px; the glyph is drawn for 20. */
  size?: number;
  /**
   * Accessible name when the glyph stands alone (a list row). Omit inside the strip, where
   * the strip's own description covers it, and the glyph is hidden from assistive technology.
   */
  'aria-label'?: string;
}

/** Levels at which the fill turns orange and then red while discharging. */
export const batteryLevels = { low: 20, critical: 10 } as const;

/** The semantic tint for a level (docs/modules/live-activities.md "Built-in notices"). */
export const batteryTint = (percent: number, charging: boolean): Tint | null => {
  if (charging) return 'green';
  if (percent <= batteryLevels.critical) return 'red';
  if (percent <= batteryLevels.low) return 'orange';
  return null;
};

const clampPercent = (percent: number): number =>
  Math.min(100, Math.max(0, Number.isFinite(percent) ? Math.round(percent) : 0));

/**
 * 20 px battery: outline body with a cap, a fill scaled to the level, a bolt while charging.
 * Green when charging, orange at ≤ 20 %, red at ≤ 10 %, otherwise the text colour. The fill is a
 * transform (`scaleX`), so level changes are cheap and mirror correctly in right-to-left text.
 */
export function BatteryGlyph({
  percent,
  charging = false,
  size = 20,
  className,
  style,
  'aria-label': label,
  ...rest
}: BatteryGlyphProps) {
  const level = clampPercent(percent);
  const tint = batteryTint(level, charging);
  const glyphStyle = {
    ...(tint === null ? style : tintStyle(tint, style)),
    '--muna-battery': level / 100,
  } as CSSProperties;
  return (
    <svg
      {...rest}
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={cx('muna-battery', tint !== null && 'muna-battery--tinted', className)}
      style={glyphStyle}
      data-level={level}
      data-charging={charging || undefined}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <rect className="muna-battery__body" x="1.5" y="5.5" width="15" height="9" rx="2.5" />
      <path
        className="muna-battery__cap"
        d="M17.5 8v4a1.5 1.5 0 0 0 1.5-1.5v-1A1.5 1.5 0 0 0 17.5 8Z"
      />
      <rect className="muna-battery__fill" x="3" y="7" width="12" height="6" rx="1.25" />
      {charging && (
        <path className="muna-battery__bolt" d="M10.6 5.5 6.5 10.8h3l-.7 3.7 4.2-5.4h-3l.6-3.6Z" />
      )}
    </svg>
  );
}
