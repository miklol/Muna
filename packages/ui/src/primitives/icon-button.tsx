import type { ReactNode } from 'react';
import { Button, type ButtonProps } from 'react-aria-components';

import './icon-button.css';
import { cx } from './shared';

export interface IconButtonProps extends Omit<
  ButtonProps,
  'className' | 'style' | 'children' | 'aria-label'
> {
  /** Required: an icon button has no visible text. */
  'aria-label': string;
  /** 28 px circle with a 16 px icon, or 36 px with a 20 px icon (panel header rail vs HUD). */
  size?: 'default' | 'large';
  /** Filled circle for the active state (e.g. the current module in a rail). */
  isActive?: boolean;
  className?: string;
  /** The icon (Lucide, 16 or 20 px). Sized by the button; pass no explicit size. */
  children: ReactNode;
}

/**
 * Circular icon button (docs/05-design-system.md#spacing--sizing): 28 px visual, 36 px
 * effective hit area, hover tints only, press scales to 0.96 with the `press` spring.
 */
export function IconButton({
  size = 'default',
  isActive = false,
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      {...rest}
      className={cx(
        'muna-icon-button',
        size === 'large' && 'muna-icon-button--large',
        isActive && 'muna-icon-button--active',
        className,
      )}
    >
      <span aria-hidden="true" className="muna-icon-button__icon">
        {children}
      </span>
    </Button>
  );
}
