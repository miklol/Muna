import type { BluetoothDeviceView, BluetoothRadioState, IpcError } from '@muna/contracts';
import type { MessageKey, Translate } from '@muna/i18n';
import {
  Button,
  contentExitTransition,
  contentRecipe,
  EmptyState,
  IconButton,
  ListRow,
  Toggle,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { Bluetooth, BluetoothOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DeviceIcon } from './bluetooth-icon';
import { type BluetoothPending, useBluetoothStore } from './bluetooth-store';
import './bluetooth.css';
import { useBluetoothCommand, useBluetoothSubscription } from './use-bluetooth';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The i18n key for a refused command, by the IPC error code the platform layer maps to. */
export const errorKey = (error: IpcError): MessageKey => {
  switch (error.code) {
    case 'platform.unsupported':
      return 'bluetooth.error.unsupported';
    case 'platform.notFound':
      return 'bluetooth.error.notFound';
    case 'platform.accessDenied':
      return 'bluetooth.error.accessDenied';
    default:
      return 'bluetooth.error.os';
  }
};

/** `80%` in the window's locale. */
const formatPercent = (percent: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    percent / 100,
  );

/** The second line of a device row: what is happening, else how it stands. */
export const deviceStatus = (
  device: BluetoothDeviceView,
  pending: BluetoothPending | undefined,
  t: Translate,
  locale: string,
): string => {
  if (pending === 'connect') return t('bluetooth.connecting');
  if (pending === 'disconnect') return t('bluetooth.disconnecting');
  if (!device.connected) return t('bluetooth.disconnected');
  return device.batteryPercent === null
    ? t('bluetooth.connected')
    : t('bluetooth.connectedBattery', { percent: formatPercent(device.batteryPercent, locale) });
};

const radioKey: Record<BluetoothRadioState, MessageKey> = {
  on: 'bluetooth.radioOn',
  off: 'bluetooth.radioOff',
  unavailable: 'bluetooth.radioUnavailable',
};

interface ErrorTextProps {
  children: ReactNode;
}

/** A refusal under a row, in `--accent-red`; announced when it appears. */
function ErrorText({ children }: ErrorTextProps) {
  return (
    <span role="alert" className="bt-error">
      {children}
    </span>
  );
}

/**
 * The Bluetooth panel (docs/modules/bluetooth.md): the radio switch first, then every paired
 * device the user has not hidden, connected ones on top — a glyph for what it is, its name, its
 * state and battery, and connect or disconnect on the right. A device Windows will not connect
 * or disconnect says so in place instead of failing silently. Rows slide with the `layout`
 * spring when a device pairs or unpairs; the panel keeps no timers.
 */
export function BluetoothPanel() {
  const { t, i18n } = useTranslation();
  useBluetoothSubscription();
  const snapshot = useBluetoothStore((store) => store.snapshot);
  const pending = useBluetoothStore((store) => store.pending);
  const errors = useBluetoothStore((store) => store.errors);
  const radioPending = useBluetoothStore((store) => store.radioPending);
  const radioError = useBluetoothStore((store) => store.radioError);
  const send = useBluetoothCommand();
  const reduceMotion = useReduceMotion();
  const layoutSpring = useMotionPreset('layout');
  const enterSpring = useMotionPreset('content');
  const locale = i18n.resolvedLanguage ?? i18n.language;

  if (snapshot === null) return null;

  if (!snapshot.available) {
    return (
      <div className="bt-panel" data-radio="unavailable">
        <EmptyState
          className="bt-empty"
          icon={<BluetoothOff size={24} strokeWidth={1.5} />}
          title={t('bluetooth.unavailable.title')}
          description={t('bluetooth.unavailable.body')}
        />
      </div>
    );
  }

  const radio = snapshot.radio;
  const devices = snapshot.devices.filter((device) => !device.hidden);
  const enterFrom = reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge;
  const visible = reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible;
  const exitTo = {
    ...(reduceMotion ? contentRecipe.reducedExitTo : contentRecipe.exitTo),
    transition: contentExitTransition,
  };

  let body: ReactNode;
  if (radio === 'off') {
    body = (
      <EmptyState
        className="bt-empty"
        icon={<BluetoothOff size={24} strokeWidth={1.5} />}
        title={t('bluetooth.off.title')}
        description={t('bluetooth.off.body')}
      />
    );
  } else if (devices.length === 0) {
    body = (
      <EmptyState
        className="bt-empty"
        icon={<Bluetooth size={24} strokeWidth={1.5} />}
        title={t('bluetooth.empty.title')}
        description={t('bluetooth.empty.body')}
      />
    );
  } else {
    body = (
      <ul className="bt-list" aria-label={t('bluetooth.devices')}>
        <AnimatePresence mode="popLayout" initial={false}>
          {devices.map((device) => {
            const inFlight = pending[device.id];
            const error = errors[device.id];
            return (
              <motion.li
                key={device.id}
                layout={!reduceMotion}
                initial={enterFrom}
                animate={visible}
                exit={exitTo}
                transition={{ ...enterSpring, layout: layoutSpring }}
                className="bt-row"
                data-connected={device.connected || undefined}
                data-pending={inFlight}
              >
                <ListRow
                  className="bt-row__content"
                  icon={<DeviceIcon kind={device.kind} strokeWidth={ICON_STROKE} />}
                  label={device.name}
                  description={
                    error === undefined ? (
                      deviceStatus(device, inFlight, t, locale)
                    ) : (
                      <ErrorText>{t(errorKey(error))}</ErrorText>
                    )
                  }
                  trailingIsControl
                  trailing={
                    device.connected ? (
                      <IconButton
                        aria-label={t('bluetooth.disconnectDevice', { name: device.name })}
                        isDisabled={inFlight !== undefined}
                        onPress={() => {
                          send({ kind: 'disconnect', id: device.id });
                        }}
                      >
                        <X strokeWidth={ICON_STROKE} />
                      </IconButton>
                    ) : (
                      <Button
                        variant="secondary"
                        isDisabled={inFlight !== undefined}
                        onPress={() => {
                          send({ kind: 'connect', id: device.id });
                        }}
                      >
                        {t('bluetooth.connect')}
                      </Button>
                    )
                  }
                />
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    );
  }

  return (
    <div className="bt-panel" data-radio={radio}>
      <ListRow
        className="bt-radio"
        icon={<Bluetooth strokeWidth={ICON_STROKE} />}
        label={t('bluetooth.radio')}
        description={
          radioError === null ? (
            t(radioKey[radio])
          ) : (
            <ErrorText>{t(errorKey(radioError))}</ErrorText>
          )
        }
        trailingIsControl
        trailing={
          <Toggle
            aria-label={t('bluetooth.radio')}
            isSelected={radio === 'on'}
            isDisabled={radio === 'unavailable' || radioPending}
            onChange={(on) => {
              send({ kind: 'setRadio', on });
            }}
          />
        }
      />
      {body}
    </div>
  );
}
