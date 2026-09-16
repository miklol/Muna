import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OptionTiles } from './option-tiles';

const items = [
  { id: 'notch', title: 'Notch', description: 'Flush with the top edge.' },
  { id: 'island', title: 'Island', description: 'Floats as a capsule.' },
] as const;

describe('OptionTiles', () => {
  it('renders a radio group named by the title and described by the description', () => {
    render(<OptionTiles aria-label="Shape" items={items} value="island" onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Shape' })).toBeInTheDocument();
    const island = screen.getByRole('radio', { name: 'Island' });
    expect(island).toBeChecked();
    expect(island).toHaveAccessibleDescription('Floats as a capsule.');
    expect(screen.getByRole('radio', { name: 'Notch' })).not.toBeChecked();
  });

  it('selects a tile from anywhere on it and never re-fires the current value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OptionTiles aria-label="Shape" items={items} value="notch" onChange={onChange} />);
    await user.click(screen.getByText('Floats as a capsule.'));
    expect(onChange).toHaveBeenCalledWith('island');
    onChange.mockClear();
    await user.click(screen.getByText('Notch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves the selection with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OptionTiles aria-label="Shape" items={items} value="notch" onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Notch' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('island');
  });

  it('marks the selected tile and hides the illustration from assistive tech', () => {
    const { container } = render(
      <OptionTiles
        aria-label="Shape"
        items={[{ ...items[0], illustration: <svg data-testid="art" /> }, items[1]]}
        value="notch"
        onChange={vi.fn()}
      />,
    );
    const selected = container.querySelectorAll('.muna-option-tile__button[data-selected]');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('Notch');
    expect(screen.getByTestId('art').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('disables single tiles and the whole group', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <OptionTiles
        aria-label="Shape"
        items={[items[0], { ...items[1], isDisabled: true }]}
        value="notch"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Island' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Island' }));
    expect(onChange).not.toHaveBeenCalled();
    rerender(
      <OptionTiles aria-label="Shape" items={items} value="notch" onChange={onChange} isDisabled />,
    );
    expect(screen.getByRole('radio', { name: 'Island' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Notch' })).toBeDisabled();
  });
});
