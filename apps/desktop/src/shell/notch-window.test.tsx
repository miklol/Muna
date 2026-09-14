import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../app-providers';
import { NotchWindow } from './notch-window';

vi.mock('@muna/contracts', () => ({
  events: {
    stripContentChanged: {
      listen: vi.fn(() => Promise.resolve(() => undefined)),
    },
  },
}));

describe('NotchWindow', () => {
  it('renders the idle strip with an accessible placeholder', () => {
    render(
      <AppProviders>
        <NotchWindow />
      </AppProviders>,
    );
    const strip = screen.getByRole('status');
    expect(strip).toHaveAttribute('data-kind', 'idle');
    expect(screen.getByText('Muna is running. The notch shell lands with M1.')).toBeInTheDocument();
  });
});
