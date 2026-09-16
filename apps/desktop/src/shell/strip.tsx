import type { StripContent } from '@muna/contracts';
import { StripView } from '@muna/ui/primitives';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { present } from './strip-content';

export interface StripProps {
  content: StripContent;
  /** `Date.now()` when `content` arrived; countdowns tick from here between publishes. */
  receivedAt: number;
}

/**
 * The closed strip (docs/05-design-system.md "Per-surface notes"): the contract's slots mapped
 * to `StripView`'s vocabulary, localised for the window's language.
 */
export function Strip({ content, receivedAt }: StripProps) {
  const { t, i18n } = useTranslation();
  const presentation = useMemo(
    () => present(content, t, i18n.language, receivedAt),
    [content, t, i18n.language, receivedAt],
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
