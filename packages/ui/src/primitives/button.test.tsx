import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('renders a secondary button by default and calls onPress', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Connect</Button>);
    const button = screen.getByRole('button', { name: 'Connect' });
    expect(button).toHaveClass('muna-button--secondary');
    await user.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('applies the variant class and hides the icon from assistive technology', () => {
    render(
      <Button variant="primary" icon={<svg data-testid="icon" />}>
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('muna-button--primary');
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('disables through React Aria', () => {
    render(
      <Button variant="destructive" isDisabled>
        Remove
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});
