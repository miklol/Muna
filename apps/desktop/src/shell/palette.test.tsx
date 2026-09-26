import { SHELL_ACTION_IDS } from '@muna/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../lib/i18n';
import type { ActionEntry } from './actions';
import { CommandPalette } from './palette';

const actions: readonly ActionEntry[] = [
  {
    id: SHELL_ACTION_IDS.togglePanel,
    labelKey: 'shortcuts.actions.togglePanel',
    groupKey: 'shortcuts.group.shell',
    runnable: true,
  },
  {
    id: SHELL_ACTION_IDS.nextModule,
    labelKey: 'shortcuts.actions.nextModule',
    groupKey: 'shortcuts.group.shell',
    runnable: true,
  },
  {
    id: 'todo.quickAdd',
    labelKey: 'todo.actions.quickAdd',
    groupKey: 'todo.title',
    runnable: true,
  },
];

const renderPalette = (onRun = vi.fn()) => {
  render(
    <I18nextProvider i18n={i18n}>
      <CommandPalette
        actions={actions}
        bindings={new Map([[SHELL_ACTION_IDS.togglePanel, 'ctrl+alt+space']])}
        onRun={onRun}
      />
    </I18nextProvider>,
  );
  return onRun;
};

describe('CommandPalette', () => {
  afterEach(cleanup);

  it('focuses the field, lists every action under its group and shows the bound chord', () => {
    renderPalette();
    const field = screen.getByRole('searchbox', { name: 'Search commands' });
    expect(document.activeElement).toBe(field);

    const list = screen.getByRole('menu', { name: 'Commands' });
    expect(
      within(list)
        .getAllByRole('menuitem')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual(['Show or hide the notch', 'Next module', 'Add a task']);
    expect(within(list).getByText('Notch')).toBeInTheDocument();
    expect(within(list).getByText('Tasks')).toBeInTheDocument();
    const toggle = within(list).getByRole('menuitem', { name: 'Show or hide the notch' });
    expect(
      within(toggle)
        .getAllByText(/^(Ctrl|Alt|Space)$/)
        .map((cap) => cap.textContent),
    ).toEqual(['Ctrl', 'Alt', 'Space']);
  });

  it('filters as you type, ignoring case, and says when nothing matches', () => {
    renderPalette();
    const field = screen.getByRole('searchbox', { name: 'Search commands' });

    fireEvent.change(field, { target: { value: 'TASK' } });
    const list = screen.getByRole('menu', { name: 'Commands' });
    expect(
      within(list)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Add a task']);
    expect(within(list).queryByText('Notch')).not.toBeInTheDocument();

    fireEvent.change(field, { target: { value: 'zzz' } });
    expect(screen.getByText('No matching commands')).toBeInTheDocument();
  });

  it('runs the chosen action on click and on Enter from the field', () => {
    const onRun = renderPalette();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a task' }));
    expect(onRun).toHaveBeenLastCalledWith('todo.quickAdd');

    const field = screen.getByRole('searchbox', { name: 'Search commands' });
    fireEvent.change(field, { target: { value: 'next' } });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRun).toHaveBeenLastCalledWith(SHELL_ACTION_IDS.nextModule);
  });
});
