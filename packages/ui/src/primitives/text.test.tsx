import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Text } from './text';

describe('Text', () => {
  it('renders a span with the body step and primary tone by default', () => {
    render(<Text>Now playing</Text>);
    const el = screen.getByText('Now playing');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveClass('muna-text', 'muna-text--body', 'muna-text--tone-primary');
  });

  it('maps every option to a class', () => {
    render(
      <Text as="h2" variant="title3" tone="secondary" weight={600} tabular truncate={2} caps>
        Focus
      </Text>,
    );
    const el = screen.getByRole('heading', { level: 2 });
    expect(el).toHaveClass(
      'muna-text--title3',
      'muna-text--tone-secondary',
      'muna-text--weight-600',
      'muna-text--tabular',
      'muna-text--truncate-2',
      'muna-text--caps',
    );
  });

  it('passes through native attributes and extra classes', () => {
    render(
      <Text as="p" lang="en" className="extra">
        14 Sep
      </Text>,
    );
    const el = screen.getByText('14 Sep');
    expect(el.tagName).toBe('P');
    expect(el).toHaveAttribute('lang', 'en');
    expect(el).toHaveClass('extra');
  });
});
