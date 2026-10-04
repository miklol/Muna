import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import './card.css';
import { cx } from './shared';
import { Text } from './text';

const headingTag = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export interface CardProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  /** Header label, 13/600. */
  title?: ReactNode;
  /**
   * The title's heading level. Panels and settings panes head with `h1`, so a card straight
   * under them is `h2` (the default); a card inside a titled section is `h3`.
   */
  headingLevel?: 2 | 3 | 4;
  /** Right side of the header: a chip, a value or an icon button. */
  trailing?: ReactNode;
  /** 20 px icon before the title, `--text-2`. */
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * Card (docs/05-design-system.md#spacing--sizing): `--surface-1` on radius `--radius-card`,
 * padding 12, no shadow. The header is 13/600 with an optional trailing slot; the body is 12 px
 * text by default (`Text variant="footnote"` children pick their own size).
 */
export function Card({
  title,
  headingLevel = 2,
  trailing,
  icon,
  className,
  children,
  ...rest
}: CardProps) {
  const hasHeader = title !== undefined || trailing !== undefined;
  return (
    <section {...rest} className={cx('muna-card', className)}>
      {hasHeader && (
        <header className="muna-card__header">
          {icon !== undefined && (
            <span aria-hidden="true" className="muna-card__icon">
              {icon}
            </span>
          )}
          {title !== undefined && (
            <Text
              as={headingTag[headingLevel]}
              variant="body"
              weight={600}
              truncate={1}
              className="muna-card__title"
            >
              {title}
            </Text>
          )}
          {trailing !== undefined && <div className="muna-card__trailing">{trailing}</div>}
        </header>
      )}
      {children !== undefined && <div className="muna-card__body">{children}</div>}
    </section>
  );
}
