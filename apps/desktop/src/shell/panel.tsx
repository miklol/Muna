import { IconButton, Text } from '@muna/ui/primitives';
import { Minimize2, Pin, PinOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface PanelProps {
  title: string;
  pinned: boolean;
  onPinChange: (pinned: boolean) => void;
  onCollapse: () => void;
  /** Module body; the empty state when no module is active. */
  children?: ReactNode;
}

/** Lucide icons at 16 px use stroke 1.75 (docs/05-design-system.md "Iconography"). */
const ICON_STROKE = 1.75;

/**
 * The expanded panel container (docs/05-design-system.md "Panel", "Panel header"): a 44 px
 * header with the title on the left and the icon rail on the right — pin, then ⤡ collapse
 * always right-most — above the body slot. The module bar and the full chrome (footer, right
 * rail of module glyphs) land with M1-E4.
 */
export function Panel({ title, pinned, onPinChange, onCollapse, children }: PanelProps) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('notch.panel')}
      data-pinned={pinned}
      className="flex h-full min-h-47.5 flex-col p-4"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2">
        <Text as="h1" variant="callout" truncate={1}>
          {title}
        </Text>
        <div className="flex items-center gap-1">
          <IconButton
            aria-label={t(pinned ? 'notch.unpin' : 'notch.pin')}
            aria-pressed={pinned}
            isActive={pinned}
            onPress={() => {
              onPinChange(!pinned);
            }}
          >
            {pinned ? <PinOff strokeWidth={ICON_STROKE} /> : <Pin strokeWidth={ICON_STROKE} />}
          </IconButton>
          <IconButton aria-label={t('notch.collapse')} onPress={onCollapse}>
            <Minimize2 strokeWidth={ICON_STROKE} />
          </IconButton>
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** What the panel shows before any module is enabled. */
export function PanelEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <Text as="p" variant="body" weight={600}>
        {t('notch.empty.title')}
      </Text>
      <Text as="p" variant="footnote" tone="secondary">
        {t('notch.empty.body')}
      </Text>
    </div>
  );
}
