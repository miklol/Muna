import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './icon-button';

const Glyph = () => <svg data-testid="glyph" viewBox="0 0 16 16" />;

describe('IconButton', () => {
  it('exposes the label and hides the glyph from assistive tech', () => {
    render(
      <IconButton aria-label="Play">
        <Glyph />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Play' });
    expect(button).toHaveClass('muna-icon-button');
    expect(screen.getByTestId('glyph').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('fires onPress and respects isDisabled', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    const { rerender } = render(
      <IconButton aria-label="Skip" onPress={onPress}>
        <Glyph />
      </IconButton>,
    );
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onPress).toHaveBeenCalledTimes(1);

    rerender(
      <IconButton aria-label="Skip" onPress={onPress} isDisabled>
        <Glyph />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Skip' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('maps size and active state to classes', () => {
    render(
      <IconButton aria-label="Media" size="large" isActive>
        <Glyph />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Media' })).toHaveClass(
      'muna-icon-button--large',
      'muna-icon-button--active',
    );
  });
});
