import { LayoutGroup, motion } from 'motion/react';
import { type ReactNode, useId } from 'react';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';

import { useMotionPreset } from '../motion/reduced-motion';
import './segmented-control.css';
import { cx } from './shared';

export interface SegmentedControlItem<Id extends string = string> {
  readonly id: Id;
  readonly label: ReactNode;
  /** 16 px icon shown before the label. */
  readonly icon?: ReactNode;
  readonly isDisabled?: boolean;
}

export interface SegmentedControlProps<Id extends string = string> {
  /** Required: a control has no visible caption of its own. */
  'aria-label': string;
  items: readonly SegmentedControlItem<Id>[];
  value: Id;
  onChange: (value: Id) => void;
  isDisabled?: boolean;
  className?: string;
}

/**
 * Segmented control (docs/05-design-system.md#spacing--sizing): 28 px tall, segments padded
 * 0 12 on a `--surface-1` track; the selected segment carries a `--surface-3` pill that glides
 * between segments with the `toggle` spring (shared `layoutId`). Radio semantics: one segment
 * is always selected and the arrow keys move between them.
 */
export function SegmentedControl<Id extends string>({
  items,
  value,
  onChange,
  isDisabled = false,
  className,
  ...labelling
}: SegmentedControlProps<Id>) {
  const groupId = useId();
  const transition = useMotionPreset('toggle');
  return (
    <LayoutGroup id={groupId}>
      <ToggleButtonGroup
        aria-label={labelling['aria-label']}
        selectionMode="single"
        disallowEmptySelection
        isDisabled={isDisabled}
        selectedKeys={[value]}
        onSelectionChange={(keys) => {
          const [next] = keys;
          if (typeof next === 'string' && next !== value) {
            onChange(next as Id);
          }
        }}
        className={cx('muna-segmented', className)}
      >
        {items.map((item) => (
          <ToggleButton
            key={item.id}
            id={item.id}
            isDisabled={item.isDisabled === true}
            className="muna-segmented__segment"
          >
            {item.id === value && (
              <motion.span
                aria-hidden="true"
                layoutId="indicator"
                className="muna-segmented__indicator"
                transition={transition}
              />
            )}
            {item.icon !== undefined && (
              <span aria-hidden="true" className="muna-segmented__icon">
                {item.icon}
              </span>
            )}
            <span className="muna-segmented__label">{item.label}</span>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </LayoutGroup>
  );
}
