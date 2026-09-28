import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LevelTrack } from './level-track';

describe('LevelTrack', () => {
  it('is a plain-fill slider named after the control, without a value by default', () => {
    render(<LevelTrack aria-label="Volume" percent={45} />);
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toHaveValue('45');
    expect(slider.closest('.muna-slider')).toHaveClass('muna-slider--plain');
    expect(document.querySelector('.muna-level-track__value')).toBeNull();
  });

  it('shows the formatted value beside the track, hidden from assistive technology', () => {
    render(<LevelTrack aria-label="Brightness" percent={70} valueText="70%" />);
    const value = document.querySelector('.muna-level-track__value');
    expect(value).toHaveTextContent('70%');
    expect(value).toHaveAttribute('aria-hidden', 'true');
    // The slider already reads its own value.
    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveValue('70');
  });

  it('keeps the level while muted and marks the root', () => {
    render(<LevelTrack aria-label="Volume" percent={45} muted valueText="45%" />);
    expect(document.querySelector('.muna-level-track')).toHaveAttribute('data-muted', 'true');
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('45');
  });

  it('reports drags and their end', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <LevelTrack aria-label="Volume" percent={45} onChange={onChange} onChangeEnd={onChangeEnd} />,
    );
    screen.getByRole('slider', { name: 'Volume' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(46);
    expect(onChangeEnd).toHaveBeenCalledWith(46);
  });
});
