import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ModuleBar, type ModuleBarItem, moduleBarCapacity, moduleBarPage } from './module-bar';

const item = (id: string): ModuleBarItem => ({ id, label: id, icon: <svg /> });
const items = ['media', 'calendar', 'timer', 'battery'].map(item);

const tabs = () => screen.getAllByRole('tab');

describe('ModuleBar', () => {
  it('renders a tablist with the active tab selected and focusable', () => {
    render(
      <ModuleBar aria-label="Modules" items={items} activeId="calendar" onActivate={vi.fn()} />,
    );
    expect(screen.getByRole('tablist', { name: 'Modules' })).toBeInTheDocument();
    const [media, calendar] = tabs();
    expect(calendar).toHaveAttribute('aria-selected', 'true');
    expect(calendar).toHaveAttribute('tabindex', '0');
    expect(media).toHaveAttribute('aria-selected', 'false');
    expect(media).toHaveAttribute('tabindex', '-1');
  });

  it('activates on click', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <ModuleBar aria-label="Modules" items={items} activeId="media" onActivate={onActivate} />,
    );
    await user.click(screen.getByRole('tab', { name: 'timer' }));
    expect(onActivate).toHaveBeenCalledWith('timer');
  });

  it('moves and activates with the arrow keys, wrapping at both ends', () => {
    const onActivate = vi.fn();
    render(
      <ModuleBar aria-label="Modules" items={items} activeId="media" onActivate={onActivate} />,
    );
    const [media, calendar, , battery] = tabs();
    media?.focus();
    fireEvent.keyDown(media!, { key: 'ArrowRight' });
    expect(onActivate).toHaveBeenLastCalledWith('calendar');
    expect(calendar).toHaveFocus();
    fireEvent.keyDown(media!, { key: 'ArrowLeft' });
    expect(onActivate).toHaveBeenLastCalledWith('battery');
    expect(battery).toHaveFocus();
    fireEvent.keyDown(media!, { key: 'End' });
    expect(onActivate).toHaveBeenLastCalledWith('battery');
    fireEvent.keyDown(media!, { key: 'Home' });
    expect(onActivate).toHaveBeenLastCalledWith('media');
  });

  it('reverses the arrow keys in right-to-left layouts', () => {
    const onActivate = vi.fn();
    render(
      <div dir="rtl">
        <ModuleBar aria-label="Modules" items={items} activeId="calendar" onActivate={onActivate} />
      </div>,
    );
    const [, calendar] = tabs();
    fireEvent.keyDown(calendar!, { key: 'ArrowLeft' });
    expect(onActivate).toHaveBeenLastCalledWith('timer');
    fireEvent.keyDown(calendar!, { key: 'ArrowRight' });
    expect(onActivate).toHaveBeenLastCalledWith('media');
  });

  it('reorders with Ctrl+Arrow and keeps focus on the moved tab', async () => {
    const onReorder = vi.fn();
    render(
      <ModuleBar
        aria-label="Modules"
        items={items}
        activeId="media"
        onActivate={vi.fn()}
        onReorder={onReorder}
      />,
    );
    const [media] = tabs();
    fireEvent.keyDown(media!, { key: 'ArrowRight', ctrlKey: true });
    expect(onReorder).toHaveBeenCalledWith(['calendar', 'media', 'timer', 'battery']);
    await act(async () => {
      await Promise.resolve();
    });
    // The first tab cannot move further left: no call.
    onReorder.mockClear();
    fireEvent.keyDown(media!, { key: 'ArrowLeft', ctrlKey: true });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('reorders by dragging a tab one slot with the pointer', () => {
    const onActivate = vi.fn();
    const onReorder = vi.fn();
    render(
      <ModuleBar
        aria-label="Modules"
        items={items}
        activeId="media"
        onActivate={onActivate}
        onReorder={onReorder}
      />,
    );
    const [media] = tabs();
    const tab = media!;
    fireEvent.pointerDown(tab, { pointerId: 1, button: 0, clientX: 100 });
    // Below the 4 px threshold nothing happens yet.
    fireEvent.pointerMove(tab, { pointerId: 1, clientX: 102 });
    expect(tab).not.toHaveAttribute('data-dragged');
    // One slot pitch (32 + 8 px) to the right lands on the second slot.
    fireEvent.pointerMove(tab, { pointerId: 1, clientX: 142 });
    expect(tab).toHaveAttribute('data-dragged');
    fireEvent.pointerUp(tab, { pointerId: 1, clientX: 142 });
    expect(onReorder).toHaveBeenCalledWith(['calendar', 'media', 'timer', 'battery']);
    // The release after a drag is not a click.
    fireEvent.click(tab);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('cancels a drag with Escape', () => {
    const onReorder = vi.fn();
    render(
      <ModuleBar
        aria-label="Modules"
        items={items}
        activeId="media"
        onActivate={vi.fn()}
        onReorder={onReorder}
      />,
    );
    const [, calendar] = tabs();
    const tab = calendar!;
    fireEvent.pointerDown(tab, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(tab, { pointerId: 1, clientX: 180 });
    expect(tab).toHaveAttribute('data-dragged');
    fireEvent.keyDown(tab, { key: 'Escape' });
    expect(tab).not.toHaveAttribute('data-dragged');
    fireEvent.pointerUp(tab, { pointerId: 1, clientX: 180 });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('does not start a drag without onReorder', () => {
    render(<ModuleBar aria-label="Modules" items={items} activeId="media" onActivate={vi.fn()} />);
    const [media] = tabs();
    fireEvent.pointerDown(media!, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(media!, { pointerId: 1, clientX: 180 });
    expect(media).not.toHaveAttribute('data-dragged');
  });

  it('pages when more modules exist than slots, opening on the active module', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 20 }, (_, i) => item(`m${String(i)}`));
    render(
      <ModuleBar
        aria-label="Modules"
        items={many}
        activeId="m17"
        onActivate={vi.fn()}
        overflowLabel="More modules"
      />,
    );
    // 16 slots: 15 tabs per page plus the pager.
    expect(moduleBarCapacity()).toBe(16);
    expect(screen.getByRole('tab', { name: 'm17' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'm0' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More modules' }));
    expect(screen.getByRole('tab', { name: 'm0' })).toBeInTheDocument();
    expect(tabs()).toHaveLength(15);
    // The active tab is on another page: the first tab here joins the tab order so the page
    // is reachable from the keyboard, not only through the pager.
    expect(screen.getByRole('tab', { name: 'm0' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'm1' })).toHaveAttribute('tabindex', '-1');
  });

  it('fits fewer slots when the measured width is narrower', () => {
    // 320 px: (320 − 8 + 8) / 40 = 8 slots, i.e. 7 tabs + pager once 9 or more modules exist.
    expect(moduleBarCapacity(320)).toBe(8);
    expect(
      moduleBarPage(
        Array.from({ length: 9 }, (_, i) => i),
        0,
        moduleBarCapacity(320),
      ),
    ).toMatchObject({ pages: 2, visible: [0, 1, 2, 3, 4, 5, 6] });
    // Never below one slot, whatever the measurement says.
    expect(moduleBarCapacity(10)).toBe(1);
  });
});

describe('moduleBarPage', () => {
  it('shows everything when it fits', () => {
    expect(moduleBarPage([1, 2, 3], 0, 16)).toEqual({
      visible: [1, 2, 3],
      pages: 1,
      page: 0,
      start: 0,
    });
  });

  it('splits into pages of capacity − 1 and clamps the page index', () => {
    const list = Array.from({ length: 7 }, (_, i) => i);
    expect(moduleBarPage(list, 0, 4)).toEqual({ visible: [0, 1, 2], pages: 3, page: 0, start: 0 });
    expect(moduleBarPage(list, 2, 4)).toEqual({ visible: [6], pages: 3, page: 2, start: 6 });
    expect(moduleBarPage(list, 9, 4).page).toBe(2);
  });
});
