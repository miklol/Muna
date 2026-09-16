import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SearchField } from './search-field';

const labels = { 'aria-label': 'Search settings', clearLabel: 'Clear search' } as const;

describe('SearchField', () => {
  it('renders a labelled search box without a clear button while empty', () => {
    render(<SearchField {...labels} placeholder="Search settings" />);
    expect(screen.getByRole('searchbox', { name: 'Search settings' })).toHaveAttribute(
      'placeholder',
      'Search settings',
    );
    expect(
      screen.getByRole('button', { name: 'Clear search', hidden: true }).closest('.muna-search'),
    ).toHaveAttribute('data-empty');
  });

  it('reports typing and clears with the button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchField {...labels} defaultValue="" onChange={onChange} />);
    await user.type(screen.getByRole('searchbox'), 'motion');
    expect(onChange).toHaveBeenLastCalledWith('motion');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('clears on Escape', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchField {...labels} defaultValue="bluetooth" onChange={onChange} />);
    await user.click(screen.getByRole('searchbox'));
    await user.keyboard('{Escape}');
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
