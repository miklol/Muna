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
  it('is a non-modal dialog named by the title, with a 44 px header: pin then collapse right-most', () => {
    renderPanel();
    const panel = screen.getByRole('dialog', { name: 'Muna' });
    expect(panel).toHaveAttribute('aria-modal', 'false');
    expect(panel).toHaveAttribute('data-pinned', 'false');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Muna');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Keep the panel open',
      'Collapse to the strip',
    ]);
    expect(panel.querySelector('header')).toHaveClass('muna-panel__header');
  });

  it('shows the empty state until a module is active', () => {
    renderPanel();
    expect(screen.getByText('Nothing to show yet')).toBeInTheDocument();
    expect(screen.getByText('Modules appear here as they are added.')).toBeInTheDocument();
  });

  it('places subtitle, chips and footer in the chrome slots', () => {
    renderPanel({
      title: 'Calendar',
      subtitle: '3 events today',
      chips: <span>Work</span>,
      footer: <span>Updated a moment ago</span>,
    });
    expect(screen.getByRole('dialog', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByText('3 events today')).toBeInTheDocument();
    expect(screen.getByText('Work').parentElement).toHaveClass('muna-panel__chips');
    expect(screen.getByText('Updated a moment ago').parentElement).toHaveClass(
      'muna-panel__footer',
    );
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
    expect(screen.getByRole('dialog', { name: 'Muna' })).toHaveAttribute('data-pinned', 'true');
    const unpin = screen.getByRole('button', { name: 'Let the panel close by itself' });
    expect(unpin).toHaveAttribute('aria-pressed', 'true');
    await user.click(unpin);
    expect(onPinChange).toHaveBeenCalledWith(false);
  });
});
