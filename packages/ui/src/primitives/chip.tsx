import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { ToggleButton, type ToggleButtonProps } from 'react-aria-components';

import './chip.css';
import { cx } from './shared';

interface ChipBaseProps {
  /** 12 px leading icon. */
  icon?: ReactNode;
  children: ReactNode;
}

export interface StaticChipProps
  extends ChipBaseProps, Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  onChange?: never;
  isSelected?: never;
}

export interface SelectableChipProps
  extends ChipBaseProps, Omit<ToggleButtonProps, 'className' | 'style' | 'children'> {
  /** Makes the chip a toggle button; selection uses `--surface-3` with the `toggle` spring. */
  onChange: (isSelected: boolean) => void;
  className?: string;
}

export type ChipProps = StaticChipProps | SelectableChipProps;

const isSelectable = (props: ChipProps): props is SelectableChipProps =>
  typeof props.onChange === 'function';

/**
 * 24 px chip (docs/05-design-system.md#spacing--sizing): `--surface-2`, radius 8, 12/600 text,
 * optional 12 px icon. Static by default; pass `onChange` to make it a selectable toggle.
 */
export function Chip(props: ChipProps) {
  if (isSelectable(props)) {
    const { icon, className, children, ...rest } = props;
    return (
      <ToggleButton {...rest} className={cx('muna-chip', 'muna-chip--selectable', className)}>
        {icon !== undefined && (
          <span aria-hidden="true" className="muna-chip__icon">
            {icon}
          </span>
        )}
        <span className="muna-chip__label">{children}</span>
      </ToggleButton>
    );
  }
  const {
    icon,
    className,
    children,
    onChange: _onChange,
    isSelected: _isSelected,
    ...rest
  } = props;
  return (
    <span {...rest} className={cx('muna-chip', className)}>
      {icon !== undefined && (
        <span aria-hidden="true" className="muna-chip__icon">
          {icon}
        </span>
      )}
      <span className="muna-chip__label">{children}</span>
    </span>
  );
}
