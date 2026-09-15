import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Hairline } from './hairline';

describe('Hairline', () => {
  it('is a horizontal separator by default', () => {
    render(<Hairline />);
    const el = screen.getByRole('separator');
    expect(el).toHaveAttribute('aria-orientation', 'horizontal');
    expect(el).toHaveClass('muna-hairline');
    expect(el).not.toHaveClass('muna-hairline--vertical');
  });

  it('supports vertical and strong variants', () => {
    render(<Hairline orientation="vertical" strong />);
    const el = screen.getByRole('separator');
    expect(el).toHaveAttribute('aria-orientation', 'vertical');
    expect(el).toHaveClass('muna-hairline--vertical', 'muna-hairline--strong');
  });
});
