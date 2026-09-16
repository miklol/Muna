import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import './empty-state.css';
import { cx } from './shared';
import { Text } from './text';

export interface EmptyStateProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** 24 px icon in `--text-3`. */
  icon?: ReactNode;
  /** One sentence saying what to do ("Connect a calendar to see today's events"). */
  title: ReactNode;
  /** Optional second line, `--text-2`. */
  description?: ReactNode;
  /** One action, usually a `Button`. */
  action?: ReactNode;
}

/**
 * Empty state (docs/05-design-system.md#components): icon 24 in `--text-3`, one sentence, one
 * action — it says what to do, never just that there is nothing.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div {...rest} className={cx('muna-empty-state', className)}>
      {icon !== undefined && (
        <span aria-hidden="true" className="muna-empty-state__icon">
          {icon}
        </span>
      )}
      <Text as="p" variant="body" weight={600} className="muna-empty-state__title">
        {title}
      </Text>
      {description !== undefined && (
        <Text as="p" variant="footnote" tone="secondary" className="muna-empty-state__description">
          {description}
        </Text>
      )}
      {action !== undefined && <div className="muna-empty-state__action">{action}</div>}
    </div>
  );
}
