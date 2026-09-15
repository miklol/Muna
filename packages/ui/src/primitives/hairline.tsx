import type { ComponentPropsWithoutRef } from 'react';

import './hairline.css';
import { cx } from './shared';

export interface HairlineProps extends ComponentPropsWithoutRef<'div'> {
  orientation?: 'horizontal' | 'vertical';
  /** `--hairline-strong`, the focused-input border weight. */
  strong?: boolean;
}

/** A 1 px divider in `--hairline`. Announced as a separator; purely visual otherwise. */
export function Hairline({
  orientation = 'horizontal',
  strong = false,
  className,
  ...rest
}: HairlineProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cx(
        'muna-hairline',
        orientation === 'vertical' && 'muna-hairline--vertical',
        strong && 'muna-hairline--strong',
        className,
      )}
      {...rest}
    />
  );
}
