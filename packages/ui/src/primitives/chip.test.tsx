import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Chip } from './chip';

describe('Chip', () => {
  it('renders a static span with an optional hidden icon', () => {
    render(<Chip icon={<svg data-testid="icon" />}>Spotify</Chip>);
    const label = screen.getByText('Spotify');
    expect(label.closest('.muna-chip')?.tagName).toBe('SPAN');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('becomes a toggle button when onChange is given', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Chip onChange={onChange} isSelected={false}>
        Focus
      </Chip>,
    );
    const button = screen.getByRole('button', { name: 'Focus' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveClass('muna-chip--selectable');
    await user.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects the selected state', () => {
    render(
      <Chip onChange={vi.fn()} isSelected>
        Focus
      </Chip>,
    );
    expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');
  });
});
