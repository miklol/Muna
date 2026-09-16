import type { ReactNode } from 'react';

import { Button } from './button';
import { EmptyState, type EmptyStateProps } from './empty-state';
import './empty-state.css';
import { cx } from './shared';

export interface ErrorStateProps extends Omit<EmptyStateProps, 'action' | 'role'> {
  /** Label of the retry button; omit for errors nothing can be done about. */
  retryLabel?: ReactNode;
  onRetry?: () => void;
}

/**
 * Error state (docs/05-design-system.md#components): the empty-state layout with the icon in
 * `--accent-red`, one sentence saying what went wrong and what to do, and a retry action.
 * Announced once as an alert when it appears.
 */
export function ErrorState({ retryLabel, onRetry, className, ...rest }: ErrorStateProps) {
  return (
    <EmptyState
      {...rest}
      role="alert"
      className={cx('muna-empty-state--error', className)}
      action={
        onRetry !== undefined && retryLabel !== undefined ? (
          <Button variant="secondary" onPress={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    />
  );
}
