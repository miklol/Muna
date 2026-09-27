import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TextField } from './text-field';

describe('TextField', () => {
  it('renders a named single-line textbox', () => {
    render(<TextField aria-label="New task" placeholder="Add a task" />);
    const input = screen.getByRole('textbox', { name: 'New task' });
    expect(input).toHaveAttribute('placeholder', 'Add a task');
    expect(input).toHaveAttribute('type', 'text');
  });

  it('reports changes and submits the trimmed value on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<TextField aria-label="New task" onChange={onChange} onSubmit={onSubmit} />);
    const input = screen.getByRole('textbox');
    await user.type(input, '  Call Sam  {Enter}');
    expect(onChange).toHaveBeenLastCalledWith('  Call Sam  ');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('Call Sam');
    // The owner decides what a submit means; the field keeps its text.
    expect(input).toHaveValue('  Call Sam  ');
  });

  it('does not submit an empty field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TextField aria-label="New task" onSubmit={onSubmit} />);
    await user.type(screen.getByRole('textbox'), '   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the leading glyph to sighted users only', () => {
    render(<TextField aria-label="New task" leading={<svg data-testid="glyph" />} />);
    expect(screen.getByTestId('glyph').closest('.muna-text-field__leading')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('is controlled when given a value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField aria-label="New task" value="Fixed" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'x');
    expect(onChange).toHaveBeenCalledWith('Fixedx');
    expect(input).toHaveValue('Fixed');
  });

  it('masks a secret and keeps the browser from saving it, but still submits it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TextField aria-label="Access token" secret onSubmit={onSubmit} />);
    // A password input has no textbox role; find it by its label.
    const input = screen.getByLabelText('Access token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    await user.type(input, 'ghp_secret{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('ghp_secret');
  });
});
