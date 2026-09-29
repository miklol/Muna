import { type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react';

import './text.css';
import { cx } from './shared';

/** Steps of the type scale (docs/05-design-system.md#typography). */
export type TextVariant =
  | 'caption2'
  | 'caption'
  | 'footnote'
  | 'body'
  | 'callout'
  | 'title3'
  | 'title2'
  | 'title1'
  | 'display';

/**
 * Readable tones. `secondary` and `tertiary` both render `--text-2` (7.3:1 on the panel);
 * `--text-3` is reserved for disabled controls and decorative marks, not for text.
 */
export type TextTone = 'primary' | 'secondary' | 'tertiary';

type TextElement =
  'span' | 'p' | 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'label' | 'time' | 'dt' | 'dd';

export interface TextProps extends Omit<ComponentPropsWithoutRef<'span'>, 'color'> {
  /** Rendered element; `span` by default so text never adds block layout by accident. */
  as?: TextElement;
  /** React 19 ref prop, for headings that receive focus when a view changes. */
  ref?: Ref<HTMLElement>;
  variant?: TextVariant;
  tone?: TextTone;
  /** Only `footnote` and `body` come in two weights; other steps have one. */
  weight?: 400 | 600;
  /** `font-variant-numeric: tabular-nums` for anything that counts. */
  tabular?: boolean;
  /** Ellipsis after one line (names) or two lines (bodies). */
  truncate?: 1 | 2;
  /** 10 px ring labels are the only all-caps text in Muna. */
  caps?: boolean;
  children?: ReactNode;
}

/** Text from the type scale. Colour comes from the tone, size from the variant, never ad hoc. */
export function Text({
  as = 'span',
  variant = 'body',
  tone = 'primary',
  weight,
  tabular = false,
  truncate,
  caps = false,
  className,
  children,
  ...rest
}: TextProps) {
  // Typed as `span` for prop checking: every `TextElement` takes the same global attributes
  // and an `HTMLElement` ref, which `ElementType` cannot express.
  const Component = as as 'span';
  return (
    <Component
      className={cx(
        'muna-text',
        `muna-text--${variant}`,
        `muna-text--tone-${tone}`,
        weight !== undefined && `muna-text--weight-${weight}`,
        tabular && 'muna-text--tabular',
        truncate !== undefined && `muna-text--truncate-${truncate}`,
        caps && 'muna-text--caps',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
