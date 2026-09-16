import type { ReactNode } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';

import './button.css';
import { cx } from './shared';

/** Primary = accent fill, secondary = `--surface-2`, destructive = red text on `--surface-2`. */
export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'style' | 'children'> {
  variant?: ButtonVariant;
  /** 16 px leading icon (Lucide, stroke 1.75). */
  icon?: ReactNode;
  className?: string;
  /** The label: a verb in sentence case ("Connect", "Snooze 10 min"). */
  children: ReactNode;
}

/**
 * Text button (docs/05-design-system.md#components): 28 px tall, padding 0 12, radius
 * `--radius-control`, 13/600 label. Hover tints only; press scales to 0.96 with the `press`
 * spring; keyboard focus shows the 2 px accent ring.
 */
export function Button({ variant = 'secondary', icon, className, children, ...rest }: ButtonProps) {
  return (
    <AriaButton {...rest} className={cx('muna-button', `muna-button--${variant}`, className)}>
      {icon !== undefined && (
        <span aria-hidden="true" className="muna-button__icon">
          {icon}
        </span>
      )}
      <span className="muna-button__label">{children}</span>
    </AriaButton>
  );
}
