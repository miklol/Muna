import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { Skeleton } from './skeleton';

describe('EmptyState', () => {
  it('renders icon, sentence and one action', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="Connect a calendar to see today's events"
        description="Google and Outlook are supported"
        action={<Button onPress={onPress}>Connect</Button>}
      />,
    );
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText("Connect a calendar to see today's events")).toBeInTheDocument();
    expect(screen.getByText('Google and Outlook are supported')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorState', () => {
  it('is an alert with a retry action', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ErrorState
        icon={<svg />}
        title="Could not reach the calendar. Check the connection and try again"
        retryLabel="Try again"
        onRetry={onRetry}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('muna-empty-state--error');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders no button without a retry handler', () => {
    render(<ErrorState title="Bluetooth is off" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Skeleton', () => {
  it('is hidden from assistive technology and sized by props', () => {
    render(<Skeleton data-testid="line" width={120} height={12} />);
    const line = screen.getByTestId('line');
    expect(line).toHaveAttribute('aria-hidden', 'true');
    expect(line).toHaveClass('muna-skeleton--text');
    expect(line).toHaveStyle({ inlineSize: '120px', blockSize: '12px' });
  });

  it('supports block and circle shapes', () => {
    render(
      <>
        <Skeleton data-testid="block" shape="block" />
        <Skeleton data-testid="circle" shape="circle" />
      </>,
    );
    expect(screen.getByTestId('block')).toHaveClass('muna-skeleton--block');
    expect(screen.getByTestId('circle')).toHaveClass('muna-skeleton--circle');
  });
});
