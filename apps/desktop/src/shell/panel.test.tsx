import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../app-providers';
import { Panel, PanelEmptyState } from './panel';

const renderPanel = (props: Partial<Parameters<typeof Panel>[0]> = {}) => {
  const onPinChange = vi.fn();
  const onCollapse = vi.fn();
  render(
    <AppProviders>
      <Panel
        title="Muna"
        pinned={false}
        onPinChange={onPinChange}
        onCollapse={onCollapse}
        {...props}
      >
        {props.children ?? <PanelEmptyState />}
      </Panel>
    </AppProviders>,
  );
  return { onPinChange, onCollapse };
};

describe('Panel', () => {
  it('is a named region with a 44 px header: title left, pin then collapse right-most', () => {
    renderPanel();
    const panel = screen.getByRole('region', { name: 'Notch panel' });
    expect(panel).toHaveAttribute('data-pinned', 'false');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Muna');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Keep the panel open',
      'Collapse to the strip',
    ]);
    expect(panel.querySelector('header')).toHaveClass('h-11');
  });

  it('shows the empty state until a module is active', () => {
    renderPanel();
    expect(screen.getByText('Nothing to show yet')).toBeInTheDocument();
    expect(screen.getByText('Modules appear here as they are added.')).toBeInTheDocument();
  });

  it('toggles the pin and reports collapse', async () => {
    const user = userEvent.setup();
    const { onPinChange, onCollapse } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Keep the panel open' }));
    expect(onPinChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Collapse to the strip' }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('reflects the pinned state in the pin button', async () => {
    const user = userEvent.setup();
    const { onPinChange } = renderPanel({ pinned: true });
    expect(screen.getByRole('region', { name: 'Notch panel' })).toHaveAttribute(
      'data-pinned',
      'true',
    );
    const unpin = screen.getByRole('button', { name: 'Let the panel close by itself' });
    expect(unpin).toHaveAttribute('aria-pressed', 'true');
    await user.click(unpin);
    expect(onPinChange).toHaveBeenCalledWith(false);
  });
});
