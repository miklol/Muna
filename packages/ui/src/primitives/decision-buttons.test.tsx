import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DecisionButtons } from './decision-buttons';

describe('DecisionButtons', () => {
  it('is a named group of two buttons that report which was pressed', async () => {
    const user = userEvent.setup();
    const onAllow = vi.fn();
    const onDeny = vi.fn();
    render(
      <DecisionButtons
        aria-label="Allow or deny"
        allowLabel="Allow"
        denyLabel="Deny"
        onAllow={onAllow}
        onDeny={onDeny}
      />,
    );
    const group = screen.getByRole('group', { name: 'Allow or deny' });
    expect(group).toHaveClass('muna-decision');
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('tints Allow and leaves Deny plain so the affirmative reads first', () => {
    render(
      <DecisionButtons
        aria-label="Allow or deny"
        allowLabel="Allow"
        denyLabel="Deny"
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveClass(
      'muna-decision__button--allow',
    );
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveClass('muna-decision__button--deny');
  });

  it('stops taking presses while disabled', async () => {
    const user = userEvent.setup();
    const onAllow = vi.fn();
    render(
      <DecisionButtons
        aria-label="Allow or deny"
        allowLabel="Allow"
        denyLabel="Deny"
        onAllow={onAllow}
        onDeny={vi.fn()}
        isDisabled
      />,
    );
    const allow = screen.getByRole('button', { name: 'Allow' });
    expect(allow).toBeDisabled();
    await user.click(allow);
    expect(onAllow).not.toHaveBeenCalled();
  });

  it('moves between the pills with Tab', async () => {
    const user = userEvent.setup();
    render(
      <DecisionButtons
        aria-label="Allow or deny"
        allowLabel="Allow"
        denyLabel="Deny"
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveFocus();
  });
});
