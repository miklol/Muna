import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import './card.css';
import { cx } from './shared';
import { Text } from './text';

export interface CardProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  /** Header label, 13/600. */
  title?: ReactNode;
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
export function Card({ title, trailing, icon, className, children, ...rest }: CardProps) {
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
            <Text as="h3" variant="body" weight={600} truncate={1} className="muna-card__title">
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
