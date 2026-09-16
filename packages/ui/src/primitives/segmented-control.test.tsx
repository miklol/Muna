import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl } from './segmented-control';

const items = [
  { id: 'notch', label: 'Notch' },
  { id: 'island', label: 'Island' },
] as const;

describe('SegmentedControl', () => {
  it('renders radio semantics with the current segment checked', () => {
    render(<SegmentedControl aria-label="Shape" items={items} value="island" onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Shape' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Island' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Notch' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the pressed segment and never empties the selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Shape" items={items} value="notch" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Island' }));
    expect(onChange).toHaveBeenCalledWith('island');
    onChange.mockClear();
    await user.click(screen.getByRole('radio', { name: 'Notch' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the gliding indicator inside the selected segment only', () => {
    const { container } = render(
      <SegmentedControl aria-label="Shape" items={items} value="notch" onChange={vi.fn()} />,
    );
    const indicators = container.querySelectorAll('.muna-segmented__indicator');
    expect(indicators).toHaveLength(1);
    expect(indicators[0]?.closest('[role="radio"]')).toHaveAttribute('aria-checked', 'true');
  });
});
