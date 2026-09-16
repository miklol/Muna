import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Toggle } from './toggle';

describe('Toggle', () => {
  it('renders a switch with a visible label', () => {
    render(<Toggle isSelected={false}>Launch at login</Toggle>);
    expect(screen.getByRole('switch', { name: 'Launch at login' })).not.toBeChecked();
  });

  it('calls onChange when pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle aria-label="Reduce motion" isSelected={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch', { name: 'Reduce motion' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects the selected state on the root for the CSS', () => {
    render(<Toggle aria-label="Pinned" isSelected onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByRole('switch').closest('.muna-toggle')).toHaveAttribute('data-selected');
  });
});
