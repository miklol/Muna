import type { BluetoothDeviceKind } from '@muna/contracts';
import {
  Bluetooth,
  Gamepad2,
  Headphones,
  Keyboard,
  Mouse,
  Smartphone,
  Speaker,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `Bluetooth` at whatever size the shell asks for. */
export function BluetoothIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Bluetooth size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}

type LucideIcon = ComponentType<{
  size?: number;
  strokeWidth?: number;
  'aria-hidden'?: boolean;
  focusable?: boolean;
}>;

const KIND_ICONS: Record<BluetoothDeviceKind, LucideIcon> = {
  headphones: Headphones,
  speaker: Speaker,
  phone: Smartphone,
  mouse: Mouse,
  keyboard: Keyboard,
  controller: Gamepad2,
  other: Bluetooth,
};

interface DeviceIconProps {
  kind: BluetoothDeviceKind;
  size?: number;
  strokeWidth?: number;
}

/** A device row's leading glyph by kind; anything Windows could not classify shows the rune. */
export function DeviceIcon({ kind, size = 20, strokeWidth = 1.5 }: DeviceIconProps) {
  const Icon = KIND_ICONS[kind];
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
