import { EmptyState, IconButton, PanelChrome } from '@muna/ui/primitives';
import { LayoutGrid, Minimize2, Pin, PinOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface PanelProps {
  /** Module title — the dialog's accessible name. */
  title: string;
  /** One line under the title ("Sitting for 4 min"). */
  subtitle?: ReactNode;
  /** Context chips beside the title. */
  chips?: ReactNode;
  /** Row under the body (pager dots, a hint, secondary actions). */
  footer?: ReactNode;
  pinned: boolean;
  onPinChange: (pinned: boolean) => void;
  onCollapse: () => void;
  /** Module body; the empty state when no module is active. */
  children?: ReactNode;
}

/** Lucide icons at 16 px use stroke 1.75 (docs/05-design-system.md "Iconography"). */
const ICON_STROKE = 1.75;

/**
 * The expanded panel (docs/05-design-system.md "Panel", "Panel header"): `PanelChrome` from
 * the design system — 44 px header with the title left and the icon rail right, pin then ⤡
 * collapse always right-most — bound to the shell's pin and collapse actions. A non-modal
 * dialog named by the module title; the module bar under it lives in `NotchWindow`.
 */
export function Panel({
  title,
  subtitle,
  chips,
  footer,
  pinned,
  onPinChange,
  onCollapse,
  children,
}: PanelProps) {
  const { t } = useTranslation();
  return (
    <PanelChrome
      title={title}
      subtitle={subtitle}
      chips={chips}
      footer={footer}
      data-pinned={pinned}
      className="h-full"
      rail={
        <>
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
        </>
      }
    >
      {children}
    </PanelChrome>
  );
}

/** What the panel shows before any module is enabled. */
export function PanelEmptyState() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<LayoutGrid strokeWidth={ICON_STROKE} />}
      title={t('notch.empty.title')}
      description={t('notch.empty.body')}
    />
  );
}
