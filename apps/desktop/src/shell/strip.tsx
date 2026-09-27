import type { StripContent } from '@muna/contracts';
import { StripView } from '@muna/ui/primitives';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type DecisionPresentation, type HudPresentation, present } from './strip-content';

export interface StripProps {
  content: StripContent;
  /** `Date.now()` when `content` arrived; countdowns tick from here between publishes. */
  receivedAt: number;
  /** How a HUD level track shows and what dragging it does; absent: display-only. */
  hud?: HudPresentation | undefined;
  /** Where a decision pair sends *Allow* / *Deny*; absent: the pills do nothing. */
  decision?: DecisionPresentation | undefined;
}

/**
 * The closed strip (docs/05-design-system.md "Per-surface notes"): the contract's slots mapped
 * to `StripView`'s vocabulary, localised for the window's language.
 */
export function Strip({ content, receivedAt, hud, decision }: StripProps) {
  const { t, i18n } = useTranslation();
  const presentation = useMemo(
    () => present(content, t, i18n.language, receivedAt, { hud, decision }),
    [content, t, i18n.language, receivedAt, hud, decision],
  );
  return (
    <StripView
      aria-label={t('notch.strip')}
      itemId={presentation.itemId}
      kind={presentation.kind}
      leading={presentation.leading}
      trailing={presentation.trailing}
      text={presentation.text}
      wide={presentation.wide}
      description={presentation.description}
      className="h-full"
    />
  );
}
