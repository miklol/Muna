import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MonthGrid } from './month-grid';

const localDay = (date: Date): string =>
  `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const labels = {
  'aria-label': 'Calendar',
  previousLabel: 'Previous month',
  nextLabel: 'Next month',
} as const;

describe('MonthGrid', () => {
  it('renders the month as an accessible grid with six rows, a heading and month buttons', () => {
    render(<MonthGrid {...labels} value="2026-09-26" onChange={vi.fn()} />);
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAccessibleName(/September 2026/);
    // Six week rows, always; the weekday header row is hidden from assistive tech by React Aria.
    expect(within(grid).getAllByRole('row')).toHaveLength(6);
    expect(grid.querySelectorAll('thead th')).toHaveLength(7);
    expect(screen.getByRole('heading')).toHaveTextContent('September 2026');
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('marks the selected day, draws at most three tinted dots and calls back with a day key', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonthGrid
        {...labels}
        value="2026-09-26"
        onChange={onChange}
        marks={{
          '2026-09-26': ['purple', 'blue'],
          '2026-09-28': ['green', 'red', 'orange', 'blue'],
        }}
      />,
    );
    const selected = screen.getByRole('button', { name: /Saturday, September 26, 2026/ });
    expect(selected).toHaveAttribute('data-selected');
    expect(selected.querySelectorAll('.muna-month-grid__mark')).toHaveLength(2);

    const busy = screen.getByRole('button', { name: /Monday, September 28, 2026/ });
    expect(busy.querySelectorAll('.muna-month-grid__mark')).toHaveLength(3);
    expect(busy).not.toHaveAttribute('data-selected');

    await user.click(busy);
    expect(onChange).toHaveBeenCalledWith('2026-09-28');
  });

  it('moves between months and reports the month on view', async () => {
    const user = userEvent.setup();
    const onFocusChange = vi.fn();
    render(
      <MonthGrid
        {...labels}
        value="2026-09-26"
        onChange={vi.fn()}
        focusedValue="2026-09-26"
        onFocusChange={onFocusChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onFocusChange).toHaveBeenCalledWith('2026-10-26');
  });

  it('returns to today and selects it from the today button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MonthGrid {...labels} value="2020-01-15" onChange={onChange} todayLabel="Today" />);
    expect(screen.getByRole('heading')).toHaveTextContent('January 2020');
    await user.click(screen.getByRole('button', { name: 'Today' }));
    const today = localDay(new Date());
    expect(onChange).toHaveBeenCalledWith(today);
    const cell = screen.getAllByRole('button').find((button) => button.hasAttribute('data-today'));
    expect(cell).toBeDefined();
  });
});
