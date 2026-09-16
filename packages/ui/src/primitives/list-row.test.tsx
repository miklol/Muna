import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ListRow } from './list-row';

describe('ListRow', () => {
  it('renders a static row with icon, label, description and a dimmed trailing value', () => {
    render(
      <ListRow
        icon={<svg data-testid="icon" />}
        label="Strip height"
        description="Default 32 px"
        trailing="32 px"
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Strip height')).toBeInTheDocument();
    expect(screen.getByText('Default 32 px')).toBeInTheDocument();
    expect(screen.getByText('32 px')).toHaveClass('muna-list-row__trailing');
  });

  it('becomes a button when onPress is given', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<ListRow label="Calendar" trailing="›" onPress={onPress} />);
    const row = screen.getByRole('button', { name: /Calendar/ });
    expect(row).toHaveClass('muna-list-row--pressable');
    await user.click(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('marks a trailing control so it keeps full-strength text', () => {
    render(
      <ListRow
        label="Launch at login"
        trailing={<input type="checkbox" aria-label="Launch at login" />}
        trailingIsControl
      />,
    );
    expect(screen.getByRole('checkbox').parentElement).toHaveClass(
      'muna-list-row__trailing--control',
    );
  });
});
