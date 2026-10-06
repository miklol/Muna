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

  it('keeps a long title and subtitle whole instead of truncating them', () => {
    const title = 'A module title long enough to be cut off before it reaches the rail';
    const subtitle = 'A subtitle that is also far too long for one line';
    render(
      <PanelChrome title={title} subtitle={subtitle}>
        Body
      </PanelChrome>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: title });
    // No one-line ellipsis class: the text wraps, so a sighted user can read all of it.
    expect(heading).not.toHaveClass('muna-text--truncate-1');
    expect(screen.getByText(subtitle)).not.toHaveClass('muna-text--truncate-1');
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
  });
});
