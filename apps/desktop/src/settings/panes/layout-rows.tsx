import type { MonitorLayout, NotchShape, PlacementMode, StripHeight } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import type { SegmentedControlItem } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import type { UpdateOptions } from '../settings-editor';
import { SegmentedRow, SliderRow, ToggleRow } from '../rows';

/** Slider ranges in CSS px: the strip is 200 wide, so ±320 keeps it on any supported screen. */
export const OFFSET_X_RANGE = 320;
export const OFFSET_Y_MAX = 48;

export type LayoutPatch = (patch: Partial<MonitorLayout>, options?: UpdateOptions) => void;

interface LayoutRowProps {
  layout: MonitorLayout;
  onChange: LayoutPatch;
}

const shapeLabel: Record<NotchShape, MessageKey> = {
  notch: 'settings.layout.shapeNotch',
  island: 'settings.layout.shapeIsland',
};

const modeLabel: Record<PlacementMode, MessageKey> = {
  overlay: 'settings.layout.modeOverlay',
  reserved: 'settings.layout.modeReserved',
};

const stripHeightLabel: Record<StripHeight, MessageKey> = {
  compact: 'settings.layout.stripCompact',
  default: 'settings.layout.stripDefault',
  comfortable: 'settings.layout.stripComfortable',
};

const useItems = <Id extends string>(
  labels: Record<Id, MessageKey>,
): readonly SegmentedControlItem<Id>[] => {
  const { t } = useTranslation();
  return (Object.keys(labels) as Id[]).map((id) => ({ id, label: t(labels[id]) }));
};

export function ShapeRow({ layout, onChange }: LayoutRowProps) {
  const { t } = useTranslation();
  const items = useItems(shapeLabel);
  return (
    <SegmentedRow
      label={t('settings.layout.shape')}
      description={t('settings.layout.shapeBody')}
      items={items}
      value={layout.shape}
      onChange={(shape) => {
        onChange({ shape });
      }}
    />
  );
}

export function ModeRow({ layout, onChange }: LayoutRowProps) {
  const { t } = useTranslation();
  const items = useItems(modeLabel);
  return (
    <SegmentedRow
      label={t('settings.layout.mode')}
      items={items}
      value={layout.mode}
      onChange={(mode) => {
        onChange({ mode });
      }}
    />
  );
}

export function StripHeightRow({ layout, onChange }: LayoutRowProps) {
  const { t } = useTranslation();
  const items = useItems(stripHeightLabel);
  return (
    <SegmentedRow
      label={t('settings.layout.stripHeight')}
      description={t('settings.layout.stripHeightBody')}
      items={items}
      value={layout.stripHeight}
      onChange={(stripHeight) => {
        onChange({ stripHeight });
      }}
    />
  );
}

export function EnabledRow({ layout, onChange }: LayoutRowProps) {
  const { t } = useTranslation();
  return (
    <ToggleRow
      label={t('settings.screens.enabled')}
      description={t('settings.screens.enabledBody')}
      isSelected={layout.enabled}
      onChange={(enabled) => {
        onChange({ enabled });
      }}
    />
  );
}

export function OffsetXRow({ layout, onChange }: LayoutRowProps) {
  const { t } = useTranslation();
  return (
    <SliderRow
      label={t('settings.position.offsetX')}
      description={t('settings.position.offsetXBody')}
      value={layout.offsetX}
      minValue={-OFFSET_X_RANGE}
      maxValue={OFFSET_X_RANGE}
      format={(value) => t('settings.position.px', { value })}
      onChange={(offsetX) => {
        onChange({ offsetX }, { debounced: true });
      }}
      onChangeEnd={(offsetX) => {
        onChange({ offsetX });
      }}
    />
  );
}

export function OffsetYRow({ layout, onChange }: LayoutRowProps) {
  const { t } = useTranslation();
  return (
    <SliderRow
      label={t('settings.position.offsetY')}
      description={t('settings.position.offsetYBody')}
      value={layout.offsetY}
      minValue={0}
      maxValue={OFFSET_Y_MAX}
      format={(value) => t('settings.position.px', { value })}
      onChange={(offsetY) => {
        onChange({ offsetY }, { debounced: true });
      }}
      onChangeEnd={(offsetY) => {
        onChange({ offsetY });
      }}
    />
  );
}
