import {
  SearchField as AriaSearchField,
  type SearchFieldProps as AriaSearchFieldProps,
  Button,
  Input,
} from 'react-aria-components';

import './search-field.css';
import { cx } from './shared';

export interface SearchFieldProps extends Omit<
  AriaSearchFieldProps,
  'className' | 'style' | 'children'
> {
  /** Required: the field has no visible caption. */
  'aria-label': string;
  placeholder?: string;
  /** Name of the clear button, e.g. "Clear search". */
  clearLabel: string;
  className?: string;
}

const glyph = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: false,
} as const;

/**
 * Search field (docs/05-design-system.md#components): 28 px tall on `--surface-1`, radius 8,
 * a 16 px magnifier in `--text-2` and a clear button that appears once there is text. Esc
 * clears; Enter submits (`onSubmit`). The field never traps focus.
 */
export function SearchField({ placeholder, clearLabel, className, ...rest }: SearchFieldProps) {
  return (
    <AriaSearchField {...rest} className={cx('muna-search', className)}>
      <span aria-hidden="true" className="muna-search__glyph">
        <svg {...glyph}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
      </span>
      <Input
        className="muna-search__input"
        {...(placeholder === undefined ? {} : { placeholder })}
      />
      <Button aria-label={clearLabel} className="muna-search__clear">
        <svg {...glyph} aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </Button>
    </AriaSearchField>
  );
}
