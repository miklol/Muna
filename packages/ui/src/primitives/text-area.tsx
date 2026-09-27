import type { Ref } from 'react';
import {
  TextArea as AriaTextArea,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components';

import './text-area.css';
import { cx } from './shared';

export interface TextAreaProps extends Omit<
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
  /**
   * `fill` (default) stretches to the owner's box and scrolls inside it — the panel editor;
   * `rows` sizes to that many lines — a short note in a settings pane.
   */
  size?: 'fill' | { rows: number };
  /** The owner places the caret (quick capture puts it at the end) or scrolls to a line. */
  textAreaRef?: Ref<HTMLTextAreaElement>;
  className?: string;
}

/**
 * TextArea (docs/05-design-system.md#components): the multi-line sibling of `TextField` —
 * `--surface-1`, radius 8, the same hover, focus and disabled treatment — for the notes
 * editor and any longer text a module asks for. Enter inserts a newline; there is no submit.
 * Spellcheck stays on: this is prose, not a token.
 */
export function TextArea({
  placeholder,
  size = 'fill',
  textAreaRef,
  className,
  ...rest
}: TextAreaProps) {
  const rows = typeof size === 'object' ? size.rows : undefined;
  return (
    <AriaTextField
      {...rest}
      className={cx('muna-text-area', rows === undefined && 'muna-text-area--fill', className)}
    >
      <AriaTextArea
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(rows === undefined ? {} : { rows })}
        {...(textAreaRef === undefined ? {} : { ref: textAreaRef })}
        className="muna-text-area__input"
      />
    </AriaTextField>
  );
}
