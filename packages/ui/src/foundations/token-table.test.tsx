import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { tokensByGroup } from '../tokens';
import { TokenTable } from './token-table';

describe('TokenTable', () => {
  it('lists every token of the group with its value', () => {
    render(<TokenTable group="radius" title="Radii" />);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(tokensByGroup('radius').length);
    expect(screen.getByRole('rowheader', { name: '--radius-panel' })).toBeInTheDocument();
    expect(screen.getByText('28px')).toBeInTheDocument();
  });

  it('labels the section by its heading', () => {
    render(<TokenTable group="shadow" title="Shadows" />);
    expect(screen.getByRole('region', { name: 'Shadows' })).toBeInTheDocument();
  });

  it('renders a live sample for type-scale steps only', () => {
    render(<TokenTable group="type" title="Type" />);
    const samples = screen.getAllByText('Now playing');
    expect(samples.length).toBeGreaterThan(0);
    // Font family / feature tokens have no per-step sample.
    expect(samples.length).toBeLessThan(tokensByGroup('type').length);
  });

  it('renders previews for colour, material, space and focus tokens', () => {
    for (const group of ['colour', 'material', 'space', 'size', 'focus'] as const) {
      const { unmount } = render(<TokenTable group={group} title={group} />);
      expect(screen.getByRole('table')).toBeInTheDocument();
      unmount();
    }
  });
});
