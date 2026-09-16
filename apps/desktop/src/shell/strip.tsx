import type { StripContent } from '@muna/contracts';
import { Text } from '@muna/ui/primitives';
import { useTranslation } from 'react-i18next';

export interface StripProps {
  content: StripContent;
}

/** The wide-form text a piece of strip content carries, if any. */
export const wideText = (content: StripContent): string | null => {
  switch (content.kind) {
    case 'notice':
      return content.notice.text;
    case 'activity':
      return content.activity.wideText;
    default:
      return null;
  }
};

const slotDescriptor = (content: StripContent, side: 'leading' | 'trailing'): string | null =>
  content.kind === 'activity' ? content.activity[side] : null;

/**
 * The closed strip (docs/05-design-system.md "Per-surface notes"): two 20 px slots inset 10 px
 * from each edge around an empty black centre, or the wide form with one line of footnote
 * text. Slot renderers for each live-activity source arrive with M1-E2; until then a slot
 * exposes its descriptor and paints nothing.
 */
export function Strip({ content }: StripProps) {
  const { t } = useTranslation();
  const text = wideText(content);
  return (
    <div
      role="region"
      aria-label={t('notch.strip')}
      data-kind={content.kind}
      data-wide={text !== null}
      className="flex h-full items-center justify-between gap-2 px-2.5"
    >
      <span
        aria-hidden="true"
        data-slot="leading"
        data-descriptor={slotDescriptor(content, 'leading')}
        className="size-(--size-strip-slot) shrink-0"
      />
      {text !== null ? (
        <Text
          as="span"
          role="status"
          variant="footnote"
          weight={600}
          truncate={1}
          className="min-w-0 flex-1 text-center"
        >
          {text}
        </Text>
      ) : (
        <span className="sr-only">{t('notch.placeholder')}</span>
      )}
      <span
        aria-hidden="true"
        data-slot="trailing"
        data-descriptor={slotDescriptor(content, 'trailing')}
        className="size-(--size-strip-slot) shrink-0"
      />
    </div>
  );
}
