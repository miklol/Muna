import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MunaMotionProvider } from '../motion/reduced-motion';
import { Ring } from './ring';

describe('Ring', () => {
  it('is a labelled meter sized by the diameter', () => {
    render(<Ring aria-label="Steps" diameter={64} value={25} />);
    const meter = screen.getByRole('meter', { name: 'Steps' });
    expect(meter).toHaveAttribute('aria-valuenow', '25');
    expect(meter.style.inlineSize).toBe('64px');
    const svg = meter.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 64 64');
    // 8 px stroke: r = (64 - 8) / 2
    expect(meter.querySelector('.muna-ring__track')).toHaveAttribute('r', '28');
  });

  it('uses the 6 px stroke for small rings and applies the tint', () => {
    render(
      <Ring aria-label="Stand" diameter={40} size="small" tint="green" value={1} maxValue={2} />,
    );
    const meter = screen.getByRole('meter', { name: 'Stand' });
    expect(meter.querySelector('.muna-ring__value')).toHaveAttribute('stroke-width', '6');
    expect(meter.style.getPropertyValue('--muna-tint')).toBe('var(--accent-green)');
  });

  it('renders centre content and works under reduced motion', () => {
    render(
      <MunaMotionProvider reduceMotion>
        <Ring aria-label="Move" diameter={80} value={80}>
          80
        </Ring>
      </MunaMotionProvider>,
    );
    expect(screen.getByText('80')).toHaveClass('muna-ring__content');
  });
});
