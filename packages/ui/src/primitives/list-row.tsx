import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Button, type ButtonProps } from 'react-aria-components';

import './list-row.css';
import { cx } from './shared';
import { Text } from './text';

interface ListRowBaseProps {
  /** 20 px leading icon, `--text-2`. */
  icon?: ReactNode;
  /** Primary text, 13 px, one line. */
  label: ReactNode;
  /** Secondary text under the label, 12 px `--text-2`, one line. */
  description?: ReactNode;
  /** Trailing value in `--text-2`, or a control (toggle, chip, icon button). */
  trailing?: ReactNode;
  /** Shows the trailing slot as a control rather than dimmed text. */
  trailingIsControl?: boolean;
  className?: string;
}

export interface StaticListRowProps
  extends ListRowBaseProps, Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className'> {
  onPress?: never;
  isDisabled?: never;
}

export interface PressableListRowProps
  extends ListRowBaseProps, Omit<ButtonProps, 'className' | 'style' | 'children'> {
  /** Makes the whole row a button (settings navigation, "Select" rows). */
  onPress: NonNullable<ButtonProps['onPress']>;
}

export type ListRowProps = StaticListRowProps | PressableListRowProps;

const isPressable = (props: ListRowProps): props is PressableListRowProps =>
  typeof props.onPress === 'function';

function RowContent({
  icon,
  label,
  description,
  trailing,
  trailingIsControl = false,
}: ListRowBaseProps) {
  return (
    <>
      {icon !== undefined && (
        <span aria-hidden="true" className="muna-list-row__icon">
          {icon}
        </span>
      )}
      <span className="muna-list-row__text">
        <Text as="span" variant="body" truncate={1} className="muna-list-row__label">
          {label}
        </Text>
        {description !== undefined && (
          <Text
            as="span"
            variant="footnote"
            tone="secondary"
            truncate={1}
            className="muna-list-row__description"
          >
            {description}
          </Text>
        )}
      </span>
      {trailing !== undefined && (
        <span
          className={cx(
            'muna-list-row__trailing',
            trailingIsControl && 'muna-list-row__trailing--control',
          )}
        >
          {trailing}
        </span>
      )}
    </>
  );
}

/**
 * List row (docs/05-design-system.md#spacing--sizing): 44 px tall, leading icon 20, label 13,
 * trailing value in `--text-2`. Static by default; `onPress` turns the row into a button whose
 * background crossfades on hover (`press` easing) and which shows the focus ring inside.
 */
export function ListRow(props: ListRowProps) {
  const { icon, label, description, trailing, trailingIsControl = false, className } = props;
  const content = { icon, label, description, trailing, trailingIsControl };
  if (isPressable(props)) {
    const {
      icon: _icon,
      label: _label,
      description: _description,
      trailing: _trailing,
      trailingIsControl: _trailingIsControl,
      className: _className,
      ...rest
    } = props;
    return (
      <Button {...rest} className={cx('muna-list-row', 'muna-list-row--pressable', className)}>
        <RowContent {...content} />
      </Button>
    );
  }
  const {
    icon: _icon,
    label: _label,
    description: _description,
    trailing: _trailing,
    trailingIsControl: _trailingIsControl,
    className: _className,
    onPress: _onPress,
    isDisabled: _isDisabled,
    ...rest
  } = props;
  return (
    <div {...rest} className={cx('muna-list-row', className)}>
      <RowContent {...content} />
    </div>
  );
}
