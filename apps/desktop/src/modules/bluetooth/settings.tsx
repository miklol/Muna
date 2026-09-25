import {
  type BluetoothDeviceKind,
  type BluetoothSettings,
  readBluetoothSettings,
  writeBluetoothSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { useTranslation } from 'react-i18next';

import { Section, ToggleRow, ValueRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { useBluetoothStore } from './bluetooth-store';
import { useBluetoothSubscription } from './use-bluetooth';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

const kindKey: Record<BluetoothDeviceKind, MessageKey> = {
  headphones: 'bluetooth.kind.headphones',
  speaker: 'bluetooth.kind.speaker',
  phone: 'bluetooth.kind.phone',
  mouse: 'bluetooth.kind.mouse',
  keyboard: 'bluetooth.kind.keyboard',
  controller: 'bluetooth.kind.controller',
  other: 'bluetooth.kind.other',
};

/**
 * Settings → Bluetooth (docs/modules/bluetooth.md): whether low-battery notices reach the
 * strip, and which paired devices the panel lists. Hiding is a setting, so it saves like any
 * other and the Rust side re-emits its snapshot with the device flagged.
 */
export function BluetoothSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  useBluetoothSubscription();
  const snapshot = useBluetoothStore((store) => store.snapshot);
  const bluetooth = readBluetoothSettings(settings);

  const write = (recipe: (current: BluetoothSettings) => BluetoothSettings) => {
    update((current) => writeBluetoothSettings(current, recipe(readBluetoothSettings(current))));
  };
  const setHidden = (id: string, hidden: boolean) => {
    write((current) => ({
      ...current,
      hiddenDevices: hidden
        ? [...current.hiddenDevices.filter((known) => known !== id), id]
        : current.hiddenDevices.filter((known) => known !== id),
    }));
  };

  const devices = snapshot?.devices ?? [];
  const deviceRows =
    devices.length === 0
      ? [
          {
            id: 'bluetooth.devices.none',
            node: <ValueRow label={t('bluetooth.settings.noDevices')} value={null} />,
          },
        ]
      : devices.map((device) => ({
          id: `bluetooth.devices.${device.id}`,
          node: (
            <ToggleRow
              label={device.name}
              description={t(kindKey[device.kind])}
              isSelected={!bluetooth.hiddenDevices.includes(device.id)}
              onChange={(shown) => {
                setHidden(device.id, !shown);
              }}
            />
          ),
        }));

  return (
    <>
      <Section
        title={t('bluetooth.settings.notices')}
        visible={everything}
        rows={[
          {
            id: 'bluetooth.lowBatteryNotices',
            node: (
              <ToggleRow
                label={t('bluetooth.settings.lowBatteryNotices')}
                description={t('bluetooth.settings.lowBatteryNoticesBody')}
                isSelected={bluetooth.lowBatteryNotices}
                onChange={(lowBatteryNotices) => {
                  write((current) => ({ ...current, lowBatteryNotices }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('bluetooth.settings.devices')}
        description={t('bluetooth.settings.devicesBody')}
        visible={everything}
        rows={deviceRows}
      />
    </>
  );
}
