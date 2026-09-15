import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MunaMotionProvider } from '../motion/reduced-motion';
import { ProgressTrack } from './progress-track';

describe('ProgressTrack', () => {
  it('is a labelled progressbar with the value range', () => {
    render(<ProgressTrack aria-label="Playback" value={30} />);
    const bar = screen.getByRole('progressbar', { name: 'Playback' });
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveClass('muna-progress-track');
    expect(bar.querySelector('.muna-progress-track__thumb')).toBeNull();
  });

  it('sets the tint and shows the thumb when seekable', () => {
    render(<ProgressTrack aria-label="Playback" value={1} maxValue={4} tint="cyan" seekable />);
    const bar = screen.getByRole('progressbar', { name: 'Playback' });
    expect(bar.style.getPropertyValue('--muna-tint')).toBe('var(--accent-cyan)');
    expect(bar).toHaveClass('muna-progress-track--seekable');
    expect(bar.querySelector('.muna-progress-track__thumb')).not.toBeNull();
    const driver = bar.querySelector<HTMLElement>('.muna-progress-track__motion')!;
    expect(driver.style.getPropertyValue('--muna-progress')).toBe('0.25');
  });

  it('renders under reduced motion', () => {
    render(
      <MunaMotionProvider reduceMotion>
        <ProgressTrack aria-label="Timer" value={50} />
      </MunaMotionProvider>,
    );
    expect(screen.getByRole('progressbar', { name: 'Timer' })).toBeInTheDocument();
  });
});
