import type { KeyboardEvent, ReactNode } from 'react';
import {
  Input,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components';

import './text-field.css';
import { cx } from './shared';

export interface TextFieldProps extends Omit<
  AriaTextFieldProps,
  | 'className'
  | 'style'
  | 'children'
  | 'validationBehavior'
  | 'validate'
  | 'isRequired'
  | 'isInvalid'
  | 'type'
> {
  /** Every field is named for assistive technology; the placeholder is not a label. */
  'aria-label': string;
  placeholder?: string;
  /** A 16 px glyph before the text (`--text-2`), like the search field's magnifier. */
  leading?: ReactNode;
  /**
   * Enter with text in the field. Gets the trimmed value; the field does not clear itself, so
   * the owner decides what a submit means. Ignored while an IME composition is open.
   */
  onSubmit?: ((value: string) => void) | undefined;
  className?: string;
}

/**
 * TextField (docs/05-design-system.md#components): a single-line input, 28 px on `--surface-1`,
 * radius 8. The focused border is `--hairline-strong`; the accent focus ring appears for
 * keyboard focus only. Quick-entry fields (a new task) pass `onSubmit`.
 */
export function TextField({ placeholder, leading, onSubmit, className, ...rest }: TextFieldProps) {
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || onSubmit === undefined || event.nativeEvent.isComposing) return;
    const value = event.currentTarget.value.trim();
    if (value === '') return;
    event.preventDefault();
    onSubmit(value);
  };
  return (
    <AriaTextField {...rest} className={cx('muna-text-field', className)}>
      {leading !== undefined && (
        <span aria-hidden="true" className="muna-text-field__leading">
          {leading}
        </span>
      )}
      <Input
        {...(placeholder === undefined ? {} : { placeholder })}
        className="muna-text-field__input"
        onKeyDown={submitOnEnter}
      />
    </AriaTextField>
  );
}
