import type { MonitorInfo, NotchShape, PlacementMode } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { Card, Hairline, ListRow, OptionTiles, Skeleton, Text } from '@muna/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { Bell, Bluetooth, Camera } from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { sameJson } from '../../lib/json';
import { displayNumber } from '../panes/screens';
import { ToggleRow } from '../rows';
import { useSettingsEditor } from '../settings-editor';
import { PlacementArt, ShapeArt } from './illustrations';

interface StepFrameProps {
  title: string;
  /** Moves focus to the title when the step appears, so the change is announced. */
  focusTitle: boolean;
  children: ReactNode;
}

function StepFrame({ title, focusTitle, children }: StepFrameProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) {
      heading.current?.focus();
    }
  }, [focusTitle]);
  return (
    <div className="onboarding-step">
      <Text as="h2" ref={heading} tabIndex={-1} variant="title2" className="onboarding-step__title">
        {title}
      </Text>
      {children}
    </div>
  );
}

export interface StepProps {
  focusTitle: boolean;
}

export function WelcomeStep({ focusTitle }: StepProps) {
  const { t } = useTranslation();
  const { settings } = useSettingsEditor();
  const { mode, shape } = settings.shell.defaults;
  return (
    <StepFrame title={t('onboarding.welcome.title')} focusTitle={focusTitle}>
      <Text as="p" variant="body" tone="secondary">
        {t('onboarding.welcome.body')}
      </Text>
      <PlacementArt mode={mode} shape={shape} window={false} />
      <Text as="p" variant="footnote" tone="secondary">
        {t('onboarding.welcome.steps')}
      </Text>
    </StepFrame>
  );
}

export interface DisplaysStepProps extends StepProps {
  monitors: UseQueryResult<MonitorInfo[]>;
}

/** One toggle per screen; a screen that follows the defaults gets its own layout only when turned off. The step is only reached with a list of two or more (see `onboardingSteps`). */
export function DisplaysStep({ focusTitle, monitors }: DisplaysStepProps) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();

  const setEnabled = (monitorId: string, enabled: boolean) => {
    update((current) => {
      const own = { ...(current.shell.monitors[monitorId] ?? current.shell.defaults), enabled };
      const rest = Object.fromEntries(
        Object.entries(current.shell.monitors).filter(([id]) => id !== monitorId),
      );
      // Back to the defaults: drop the override so Multiple screens shows "Use the defaults".
      const monitors = sameJson(own, current.shell.defaults) ? rest : { ...rest, [monitorId]: own };
      return { ...current, shell: { ...current.shell, monitors } };
    });
  };

  return (
    <StepFrame title={t('onboarding.displays.title')} focusTitle={focusTitle}>
      <Text as="p" variant="body" tone="secondary">
        {t('onboarding.displays.body')}
      </Text>
      {monitors.isPending && <Skeleton shape="block" width="100%" height={88} />}
      {monitors.isSuccess && (
        <Card>
          {monitors.data.map((monitor, index) => {
            const layout = settings.shell.monitors[monitor.id] ?? settings.shell.defaults;
            const number = displayNumber(monitor.id, index);
            const size = t('onboarding.displays.geometry', {
              width: monitor.bounds.width,
              height: monitor.bounds.height,
            });
            return (
              <Fragment key={monitor.id}>
                {index > 0 && <Hairline />}
                <ToggleRow
                  label={t('onboarding.displays.display', { number })}
                  description={
                    monitor.isPrimary ? `${size} · ${t('onboarding.displays.primary')}` : size
                  }
                  isSelected={layout.enabled}
                  onChange={(enabled) => {
                    setEnabled(monitor.id, enabled);
                  }}
                />
              </Fragment>
            );
          })}
        </Card>
      )}
    </StepFrame>
  );
}

const placementCaption: Record<PlacementMode, MessageKey> = {
  overlay: 'onboarding.placement.overlayCaption',
  reserved: 'onboarding.placement.reservedCaption',
};

/** Overlay or Reserved for every screen, with the trade-off acted out above the tiles. */
export function PlacementStep({ focusTitle }: StepProps) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const { mode, shape } = settings.shell.defaults;
  return (
    <StepFrame title={t('onboarding.placement.title')} focusTitle={focusTitle}>
      <div className="flex flex-col items-center gap-2">
        <PlacementArt mode={mode} shape={shape} />
        <Text as="p" variant="footnote" tone="secondary" className="text-center">
          {t(placementCaption[mode])}
        </Text>
      </div>
      <OptionTiles<PlacementMode>
        aria-label={t('settings.layout.mode')}
        items={[
          {
            id: 'overlay',
            title: t('onboarding.placement.overlay'),
            description: t('onboarding.placement.overlayBody'),
          },
          {
            id: 'reserved',
            title: t('onboarding.placement.reserved'),
            description: t('onboarding.placement.reservedBody'),
          },
        ]}
        value={mode}
        onChange={(next) => {
          update((current) => ({
            ...current,
            shell: { ...current.shell, defaults: { ...current.shell.defaults, mode: next } },
          }));
        }}
      />
    </StepFrame>
  );
}

/** Notch or Island — equal alternatives (docs/01-product-vision.md, Windows-specific decisions). */
export function ShapeStep({ focusTitle }: StepProps) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  return (
    <StepFrame title={t('onboarding.shape.title')} focusTitle={focusTitle}>
      <Text as="p" variant="body" tone="secondary">
        {t('onboarding.shape.body')}
      </Text>
      <OptionTiles<NotchShape>
        aria-label={t('settings.layout.shape')}
        items={[
          {
            id: 'notch',
            title: t('onboarding.shape.notch'),
            description: t('onboarding.shape.notchBody'),
            illustration: <ShapeArt shape="notch" />,
          },
          {
            id: 'island',
            title: t('onboarding.shape.island'),
            description: t('onboarding.shape.islandBody'),
            illustration: <ShapeArt shape="island" />,
          },
        ]}
        value={settings.shell.defaults.shape}
        onChange={(shape) => {
          update((current) => ({
            ...current,
            shell: { ...current.shell, defaults: { ...current.shell.defaults, shape } },
          }));
        }}
      />
    </StepFrame>
  );
}

const PERMISSION_ICON_SIZE = 20;
const PERMISSION_ICON_STROKE = 1.5;

/** Informational only: permissions are requested lazily by the module that needs them. */
export function PermissionsStep({ focusTitle }: StepProps) {
  const { t } = useTranslation();
  const rows = [
    {
      id: 'bluetooth',
      icon: <Bluetooth size={PERMISSION_ICON_SIZE} strokeWidth={PERMISSION_ICON_STROKE} />,
      label: t('onboarding.permissions.bluetooth'),
      description: t('onboarding.permissions.bluetoothBody'),
    },
    {
      id: 'notifications',
      icon: <Bell size={PERMISSION_ICON_SIZE} strokeWidth={PERMISSION_ICON_STROKE} />,
      label: t('onboarding.permissions.notifications'),
      description: t('onboarding.permissions.notificationsBody'),
    },
    {
      id: 'camera',
      icon: <Camera size={PERMISSION_ICON_SIZE} strokeWidth={PERMISSION_ICON_STROKE} />,
      label: t('onboarding.permissions.camera'),
      description: t('onboarding.permissions.cameraBody'),
    },
  ];
  return (
    <StepFrame title={t('onboarding.permissions.title')} focusTitle={focusTitle}>
      <Text as="p" variant="body" tone="secondary">
        {t('onboarding.permissions.body')}
      </Text>
      <Card>
        {rows.map((row, index) => (
          <Fragment key={row.id}>
            {index > 0 && <Hairline />}
            <ListRow icon={row.icon} label={row.label} description={row.description} />
          </Fragment>
        ))}
      </Card>
    </StepFrame>
  );
}

export function StartupStep({ focusTitle }: StepProps) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  return (
    <StepFrame title={t('onboarding.startup.title')} focusTitle={focusTitle}>
      <Text as="p" variant="body" tone="secondary">
        {t('onboarding.startup.body')}
      </Text>
      <Card>
        <ToggleRow
          label={t('onboarding.startup.launchAtLogin')}
          description={t('onboarding.startup.launchAtLoginBody')}
          isSelected={settings.general.launchAtLogin}
          onChange={(launchAtLogin) => {
            update((current) => ({
              ...current,
              general: { ...current.general, launchAtLogin },
            }));
          }}
        />
      </Card>
    </StepFrame>
  );
}

export function DoneStep({ focusTitle }: StepProps) {
  const { t } = useTranslation();
  const { settings } = useSettingsEditor();
  const { mode, shape } = settings.shell.defaults;
  return (
    <StepFrame title={t('onboarding.done.title')} focusTitle={focusTitle}>
      <Text as="p" variant="body" tone="secondary">
        {t('onboarding.done.body')}
      </Text>
      <PlacementArt mode={mode} shape={shape} window={false} />
      <Text as="p" variant="footnote" tone="secondary">
        {t('onboarding.done.hint')}
      </Text>
    </StepFrame>
  );
}
