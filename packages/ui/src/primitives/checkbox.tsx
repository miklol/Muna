import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { CheckboxButton, CheckboxField, type CheckboxFieldProps } from 'react-aria-components';

import { useMotionPreset, useReduceMotion } from '../motion/reduced-motion';
import './checkbox.css';
import { cx } from './shared';

export interface CheckboxProps extends Omit<
  CheckboxFieldProps,
  | 'className'
  | 'style'
  | 'children'
  | 'validationBehavior'
  | 'validate'
  | 'isRequired'
  | 'isInvalid'
  | 'isIndeterminate'
> {
  /** Visible label; without one, pass `aria-label`. */
  children?: ReactNode;
  className?: string;
}

/** The check, drawn inside the 20 px box; `pathLength` runs from its start to its end. */
const CHECK_PATH = 'M6 10.4l2.7 2.7L14.2 7.4';

/**
 * Checkbox (docs/05-design-system.md#spacing--sizing): a 20 px circle — a 1.5 px
 * `--hairline-strong` ring at rest, the accent with an `--on-accent` check when selected. The
 * check draws in with the `toggle` spring and the fill follows the same easing; under reduced
 * motion the check appears and the fill switches instantly. Task rows use it to complete a task.
 */
export function Checkbox({ children, className, ...rest }: CheckboxProps) {
  const reduceMotion = useReduceMotion();
  const draw = useMotionPreset('toggle');
  return (
    <CheckboxField {...rest} className={cx('muna-checkbox', className)}>
      <CheckboxButton className="muna-checkbox__button">
        {({ isSelected }) => (
          <>
            <span aria-hidden="true" className="muna-checkbox__box">
              <svg className="muna-checkbox__mark" viewBox="0 0 20 20">
                <motion.path
                  d={CHECK_PATH}
                  initial={false}
                  animate={{ pathLength: isSelected ? 1 : 0, opacity: isSelected ? 1 : 0 }}
                  transition={reduceMotion ? { ...draw, pathLength: { duration: 0 } } : draw}
                />
              </svg>
            </span>
            {children !== undefined && <span className="muna-checkbox__label">{children}</span>}
          </>
        )}
      </CheckboxButton>
    </CheckboxField>
  );
}
