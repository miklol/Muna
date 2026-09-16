import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IconButton } from './icon-button';
import { PanelChrome } from './panel-chrome';

describe('PanelChrome', () => {
  it('is a non-modal dialog labelled by its title', () => {
    render(
      <PanelChrome title="Calendar" subtitle="3 events today">
        Body
      </PanelChrome>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Calendar' });
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByText('3 events today')).toBeInTheDocument();
    expect(screen.getByText('Body')).toHaveClass('muna-panel__body');
  });

  it('places chips, rail and footer in their slots', () => {
    render(
      <PanelChrome
        title="Media"
        chips={<span>Spotify</span>}
        rail={
          <IconButton aria-label="Collapse">
            <svg />
          </IconButton>
        }
        footer={<span>Footer</span>}
      >
        Body
      </PanelChrome>,
    );
    expect(screen.getByText('Spotify').parentElement).toHaveClass('muna-panel__chips');
    expect(screen.getByRole('button', { name: 'Collapse' }).parentElement).toHaveClass(
      'muna-panel__rail',
    );
    expect(screen.getByText('Footer').parentElement).toHaveClass('muna-panel__footer');
  });
});
