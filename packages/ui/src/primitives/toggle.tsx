import type { ReactNode } from 'react';
import { SwitchButton, SwitchField, type SwitchFieldProps } from 'react-aria-components';

import './toggle.css';
import { cx } from './shared';

export interface ToggleProps extends Omit<
  SwitchFieldProps,
  | 'className'
  | 'style'
  | 'children'
  | 'validationBehavior'
  | 'validate'
  | 'isRequired'
  | 'isInvalid'
> {
  /** Visible label; without one, pass `aria-label`. */
  children?: ReactNode;
  className?: string;
}

/**
 * Toggle (docs/05-design-system.md#spacing--sizing): 36 × 20 track with a 16 px knob. The
 * knob glides with the `toggle` spring and the track colour follows; on, the track is the
 * accent with an `--on-accent` knob. Under reduced motion both switch instantly.
 */
export function Toggle({ children, className, ...rest }: ToggleProps) {
  return (
    <SwitchField {...rest} className={cx('muna-toggle', className)}>
      <SwitchButton className="muna-toggle__button">
        <span aria-hidden="true" className="muna-toggle__track">
          <span className="muna-toggle__knob" />
        </span>
        {children !== undefined && <span className="muna-toggle__label">{children}</span>}
      </SwitchButton>
    </SwitchField>
  );
}
