import { Text } from '@muna/ui';
import { Bluetooth, BluetoothOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { DeviceIcon } from './bluetooth-icon';
import { useBluetoothStore } from './bluetooth-store';
import './bluetooth.css';
import { useBluetoothSubscription } from './use-bluetooth';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;
const ROW_ICON = 14;

/** Rows a card shows before it says how many more there are. */
export const WIDGET_ROWS = 3;

/** `80%` in the window's locale. */
const formatPercent = (percent: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    percent / 100,
  );

/**
 * The Bluetooth card on the dashboard (docs/modules/dashboard.md "Widgets": Bluetooth
 * devices): the connected devices the user has not hidden, each with its glyph, name and
 * battery. A radio that is off or missing says so in one line; so does having nothing
 * connected. Subscribes like the panel and unlistens on unmount.
 */
export function BluetoothWidget(_props: WidgetProps) {
  const { t, i18n } = useTranslation();
  useBluetoothSubscription();
  const snapshot = useBluetoothStore((store) => store.snapshot);
  const locale = i18n.resolvedLanguage ?? i18n.language;

  if (snapshot === null) return null;

  const connected = snapshot.available
    ? snapshot.devices.filter((device) => device.connected && !device.hidden)
    : [];
  if (!snapshot.available || snapshot.radio !== 'on' || connected.length === 0) {
    const text = !snapshot.available
      ? t('bluetooth.unavailable.title')
      : snapshot.radio === 'off'
        ? t('bluetooth.off.title')
        : snapshot.radio === 'unavailable'
          ? t('bluetooth.radioUnavailable')
          : t('bluetooth.widget.none');
    return (
      <div className="bt-widget" data-empty>
        {snapshot.available && snapshot.radio === 'on' ? (
          <Bluetooth size={20} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
        ) : (
          <BluetoothOff size={20} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
        )}
        <Text as="p" variant="footnote" tone="secondary" className="bt-widget__note">
          {text}
        </Text>
      </div>
    );
  }

  const shown = connected.slice(0, WIDGET_ROWS);
  const rest = connected.length - shown.length;
  return (
    <div className="bt-widget">
      <ul className="bt-widget__list" aria-label={t('bluetooth.devices')}>
        {shown.map((device) => (
          <li key={device.id} className="bt-widget__row">
            <DeviceIcon kind={device.kind} size={ROW_ICON} strokeWidth={ICON_STROKE} />
            <Text as="span" variant="footnote" truncate={1} className="bt-widget__name">
              {device.name}
            </Text>
            {device.batteryPercent !== null && (
              <Text
                as="span"
                variant="caption"
                tone="secondary"
                tabular
                className="bt-widget__battery"
              >
                {formatPercent(device.batteryPercent, locale)}
              </Text>
            )}
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <Text as="p" variant="caption" tone="tertiary" className="bt-widget__more">
          {t('bluetooth.widget.more', { count: rest })}
        </Text>
      )}
    </div>
  );
}
