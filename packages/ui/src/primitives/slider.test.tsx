import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Slider } from './slider';

describe('Slider', () => {
  it('renders an accessible range input with the value', () => {
    render(<Slider aria-label="Volume" value={40} />);
    const input = screen.getByRole('slider', { name: 'Volume' });
    expect(input).toHaveValue('40');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '100');
  });

  it('steps with the keyboard and reports the change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Slider aria-label="Volume" value={40} onChange={onChange} />);
    const input = screen.getByRole('slider', { name: 'Volume' });
    input.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(41);
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('carries the tint on the root', () => {
    render(<Slider aria-label="Brightness" value={10} tint="orange" />);
    const root = screen.getByRole('slider').closest('.muna-slider');
    expect(root).toHaveStyle({ '--muna-tint': 'var(--accent-orange)' });
  });
});
