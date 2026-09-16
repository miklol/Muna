import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BatteryGlyph, batteryTint } from './battery-glyph';

describe('BatteryGlyph', () => {
  it('is hidden from assistive technology unless labelled', () => {
    const { container, rerender } = render(<BatteryGlyph percent={57} />);
    const glyph = container.querySelector('svg')!;
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveAttribute('data-level', '57');
    expect(glyph.style.getPropertyValue('--muna-battery')).toBe('0.57');
    expect(glyph.querySelector('.muna-battery__bolt')).toBeNull();

    rerender(<BatteryGlyph percent={57} aria-label="Battery 57 %" />);
    expect(screen.getByRole('img', { name: 'Battery 57 %' })).toBeInTheDocument();
  });

  it('paints charging green with a bolt', () => {
    const { container } = render(<BatteryGlyph percent={20} charging />);
    const glyph = container.querySelector('svg')!;
    expect(glyph).toHaveClass('muna-battery--tinted');
    expect(glyph.style.getPropertyValue('--muna-tint')).toBe('var(--accent-green)');
    expect(glyph).toHaveAttribute('data-charging', 'true');
    expect(glyph.querySelector('.muna-battery__bolt')).not.toBeNull();
  });

  it('tints low levels orange then red, and clamps the level', () => {
    expect(batteryTint(57, false)).toBeNull();
    expect(batteryTint(20, false)).toBe('orange');
    expect(batteryTint(10, false)).toBe('red');
    expect(batteryTint(5, true)).toBe('green');
    const { container } = render(<BatteryGlyph percent={140} />);
    expect(container.querySelector('svg')).toHaveAttribute('data-level', '100');
  });
});
