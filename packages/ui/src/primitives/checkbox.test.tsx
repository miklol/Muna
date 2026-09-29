import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('renders a checkbox with a visible label', () => {
    render(<Checkbox isSelected={false}>Buy milk</Checkbox>);
    expect(screen.getByRole('checkbox', { name: 'Buy milk' })).not.toBeChecked();
  });

  it('calls onChange when pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox aria-label="Complete Buy milk" isSelected={false} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'Complete Buy milk' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggles from the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox aria-label="Complete" isSelected onChange={onChange} />);
    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('reflects the selected state on the root for the CSS', () => {
    render(<Checkbox aria-label="Done" isSelected onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox').closest('.muna-checkbox')).toHaveAttribute('data-selected');
  });

  it('keeps the check out of the accessibility tree', () => {
    render(<Checkbox aria-label="Done" isSelected onChange={vi.fn()} />);
    const box = document.querySelector('.muna-checkbox__box');
    expect(box).toHaveAttribute('aria-hidden', 'true');
    expect(box?.querySelector('path')).not.toBeNull();
  });
});
