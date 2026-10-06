import { commands } from '@muna/contracts';
import { Button, EmptyState, IconButton, PanelChrome, Text } from '@muna/ui/primitives';
import { LayoutGrid, Minimize2, Pin, PinOff, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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

/** Why the panel has no module to show. */
export type PanelEmptyReason =
  /** This build registers no modules at all: nothing the user can switch on. */
  | 'none'
  /** Modules exist but every one is turned off in Settings → Modules. */
  | 'disabled';

export interface PanelEmptyStateProps {
  reason?: PanelEmptyReason;
  /** Opens the settings window; defaults to the shell command. Tests inject a fake. */
  openSettings?: () => Promise<void>;
}

/**
 * What the panel shows without an active module. A build with no modules says so and offers
 * nothing (an "enable" action would be a lie); modules turned off in Settings get a real
 * *Open settings* action, with the failure shown inline rather than swallowed.
 */
export function PanelEmptyState({
  reason = 'none',
  openSettings = () => commands.openSettings(),
}: PanelEmptyStateProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (reason === 'none') {
    return (
      <EmptyState
        icon={<LayoutGrid strokeWidth={ICON_STROKE} />}
        title={t('notch.empty.title')}
        description={t('notch.empty.body')}
      />
    );
  }
  return (
    <EmptyState
      icon={<SlidersHorizontal strokeWidth={ICON_STROKE} />}
      title={t('notch.empty.disabledTitle')}
      description={
        failed ? (
          <Text as="span" role="alert" variant="footnote" tone="secondary">
            {t('notch.empty.openSettingsFailed')}
          </Text>
        ) : (
          t('notch.empty.disabledBody')
        )
      }
      action={
        <Button
          variant="primary"
          onPress={() => {
            setFailed(false);
            openSettings().catch(() => {
              setFailed(true);
            });
          }}
        >
          {t('notch.empty.openSettings')}
        </Button>
      }
    />
  );
}
