import type { StripContent } from '@muna/contracts';
import { StripView } from '@muna/ui/primitives';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../lib/locale';
import { type DecisionPresentation, type HudPresentation, present } from './strip-content';

export interface StripProps {
  content: StripContent;
  /** `Date.now()` when `content` arrived; countdowns tick from here between publishes. */
  receivedAt: number;
  /** How a HUD level track shows and what dragging it does; absent: display-only. */
  hud?: HudPresentation | undefined;
  /** Where a decision pair sends *Allow* / *Deny*; absent: the pills do nothing. */
  decision?: DecisionPresentation | undefined;
  /** Settings → Appearance → Announce notices: read each new notice through the live region. */
  announce?: boolean;
}

/**
 * The closed strip (docs/05-design-system.md "Per-surface notes"): the contract's slots mapped
 * to `StripView`'s vocabulary, localised for the window's language.
 */
export function Strip({ content, receivedAt, hud, decision, announce = false }: StripProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const presentation = useMemo(
    () => present(content, t, locale, receivedAt, { hud, decision }),
    [content, t, locale, receivedAt, hud, decision],
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
      announce={announce}
      className="h-full"
    />
  );
}
