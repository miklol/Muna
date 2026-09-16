import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react';

import './panel-chrome.css';
import { cx } from './shared';
import { Text } from './text';

export interface PanelChromeProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  /** Module title, `--text-callout`; also the dialog's accessible name. */
  title: ReactNode;
  /** One line under the title, `--text-footnote` in `--text-2` ("Sitting for 4 min"). */
  subtitle?: ReactNode;
  /** Context chips after the title (`Chip`s). */
  chips?: ReactNode;
  /** Right rail of 28 px icon buttons at 4 px gaps; ⤡ collapse is always the right-most. */
  rail?: ReactNode;
  /** Optional row under the body (pager dots, a hint, secondary actions). */
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * Expanded-panel chrome (docs/05-design-system.md "Panel", "Panel header";
 * docs/reference/ui-observations.md §2): 16 px padding all round so card corners stay
 * concentric, a 44 px header — title and subtitle left, chips beside them, the icon rail right —
 * then the body slot and an optional footer. A non-modal dialog labelled by its title; nothing
 * inside traps focus.
 */
export function PanelChrome({
  title,
  subtitle,
  chips,
  rail,
  footer,
  className,
  children,
  ...rest
}: PanelChromeProps) {
  const titleId = useId();
  return (
    <section
      {...rest}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={cx('muna-panel', className)}
    >
      <header className="muna-panel__header">
        <div className="muna-panel__heading">
          <Text as="h1" id={titleId} variant="callout" truncate={1} className="muna-panel__title">
            {title}
          </Text>
          {subtitle !== undefined && (
            <Text as="p" variant="footnote" tone="secondary" truncate={1}>
              {subtitle}
            </Text>
          )}
        </div>
        {chips !== undefined && <div className="muna-panel__chips">{chips}</div>}
        {rail !== undefined && <div className="muna-panel__rail">{rail}</div>}
      </header>
      <div className="muna-panel__body">{children}</div>
      {footer !== undefined && <footer className="muna-panel__footer">{footer}</footer>}
    </section>
  );
}
