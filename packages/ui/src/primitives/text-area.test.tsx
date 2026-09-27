import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TextArea } from './text-area';

describe('TextArea', () => {
  it('renders a named multi-line textbox that fills its owner by default', () => {
    render(<TextArea aria-label="Note text" placeholder="Start writing" />);
    const area = screen.getByRole('textbox', { name: 'Note text' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAttribute('placeholder', 'Start writing');
    expect(area).not.toHaveAttribute('rows');
    expect(area.closest('.muna-text-area')).toHaveClass('muna-text-area--fill');
  });

  it('sizes to rows when asked', () => {
    render(<TextArea aria-label="Note text" size={{ rows: 3 }} />);
    const area = screen.getByRole('textbox');
    expect(area).toHaveAttribute('rows', '3');
    expect(area.closest('.muna-text-area')).not.toHaveClass('muna-text-area--fill');
  });

  it('reports changes and keeps newlines: Enter is a line break, not a submit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextArea aria-label="Note text" onChange={onChange} />);
    const area = screen.getByRole('textbox');
    await user.type(area, 'one{Enter}two');
    expect(onChange).toHaveBeenLastCalledWith('one\ntwo');
    expect(area).toHaveValue('one\ntwo');
  });

  it('hands the owner the element so the caret can be placed', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLTextAreaElement>();
    render(<TextArea aria-label="Note text" defaultValue={'milk\neggs'} textAreaRef={ref} />);
    expect(ref.current).toBe(screen.getByRole('textbox'));
    ref.current?.focus();
    ref.current?.setSelectionRange(9, 9);
    await user.keyboard('{Enter}bread');
    expect(ref.current).toHaveValue('milk\neggs\nbread');
  });

  it('is controlled when given a value and tells the owner when focus leaves', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<TextArea aria-label="Note text" value="Fixed" onChange={onChange} onBlur={onBlur} />);
    const area = screen.getByRole('textbox');
    await user.type(area, 'x');
    expect(onChange).toHaveBeenCalledWith('Fixedx');
    expect(area).toHaveValue('Fixed');
    await user.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', () => {
    render(<TextArea aria-label="Note text" isDisabled defaultValue="Read only" />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
