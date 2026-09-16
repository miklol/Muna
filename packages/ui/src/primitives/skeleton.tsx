import type { ComponentPropsWithoutRef } from 'react';

import { cx } from './shared';
import './skeleton.css';

export interface SkeletonProps extends ComponentPropsWithoutRef<'span'> {
  /** Shape of the placeholder: a text line, a card-cornered block or a circle. */
  shape?: 'text' | 'block' | 'circle';
  /** CSS size; text lines default to a full-width 12 px line, circles to 20 px. */
  width?: number | string;
  height?: number | string;
}

/**
 * Loading placeholder (docs/06-motion-spec.md#timings-non-spring): `--surface-*` shimmer from
 * 0.06 to 0.12 opacity on a 1.6 s linear loop (`timings.shimmerLoopMs` via
 * `--muna-motion-shimmer`); static under reduced motion. Never used on the strip. Hidden from
 * assistive technology — mark the loading container `aria-busy` instead.
 */
export function Skeleton({
  shape = 'text',
  width,
  height,
  className,
  style,
  ...rest
}: SkeletonProps) {
  return (
    <span
      {...rest}
      aria-hidden="true"
      className={cx('muna-skeleton', `muna-skeleton--${shape}`, className)}
      style={{ ...style, inlineSize: width, blockSize: height }}
    />
  );
}
