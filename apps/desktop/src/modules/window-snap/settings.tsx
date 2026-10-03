import {
  defaultWindowSnapSettings,
  normaliseSnapGrid,
  normaliseWindowSnapSettings,
  readWindowSnapSettings,
  SNAP_ZONES,
  type SnapZone,
  snapTileCount,
  WINDOW_SNAP_BOUNDS,
  type WindowSnapSettings,
  writeWindowSnapSettings,
} from '@muna/contracts';
import type { SegmentedControlItem } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import {
  type RowSpec,
  Section,
  SegmentedRow,
  SliderRow,
  ToggleRow,
  ValueRow,
} from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { zoneLabelKey } from './zones';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/** What the grid starts as when switched on: four cells with a small gutter. */
const STARTER_GRID = { rows: 2, cols: 2, gap: 8 } as const;

const range = (bounds: { min: number; max: number }): readonly number[] =>
  Array.from({ length: bounds.max - bounds.min + 1 }, (_, index) => bounds.min + index);

/**
 * Settings → Window snap (docs/modules/window-snap.md "Reference": "Choose snap zones (10/10)"):
 * a toggle per built-in zone, and an optional grid whose cells count towards the same ten.
 * Writes go through the shared editor and are normalised like Rust does, so the pane always
 * shows what the notch will offer.
 */
export function WindowSnapSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const snap = readWindowSnapSettings(settings);
  const count = snapTileCount(snap);
  const max = WINDOW_SNAP_BOUNDS.zones.max;
  const full = count >= max;

  const write = (recipe: (current: WindowSnapSettings) => WindowSnapSettings) => {
    update((current) =>
      writeWindowSnapSettings(
        current,
        normaliseWindowSnapSettings(recipe(readWindowSnapSettings(current))),
      ),
    );
  };
  const setZone = (zone: SnapZone, enabled: boolean) => {
    write((current) => ({
      ...current,
      zones: enabled
        ? SNAP_ZONES.filter((candidate) => candidate === zone || current.zones.includes(candidate))
        : current.zones.filter((candidate) => candidate !== zone),
    }));
  };
  const setGrid = (patch: Partial<{ rows: number; cols: number; gap: number }>) => {
    write((current) => ({
      ...current,
      grid: normaliseSnapGrid({ ...(current.grid ?? STARTER_GRID), ...patch }),
    }));
  };
  const segments = (values: readonly number[]): SegmentedControlItem[] =>
    values.map((value) => ({ id: String(value), label: String(value) }));

  const zoneRows: RowSpec[] = SNAP_ZONES.map((zone) => {
    const selected = snap.zones.includes(zone);
    // The last zone stays on while there is no grid: no zones at all reads as the defaults.
    const last = selected && snap.zones.length === 1 && snap.grid === null;
    return {
      id: `windowSnap.zone.${zone}`,
      node: (
        <ToggleRow
          label={t(zoneLabelKey(zone))}
          isSelected={selected}
          isDisabled={(!selected && full) || last}
          onChange={(enabled) => {
            setZone(zone, enabled);
          }}
        />
      ),
    };
  });

  const gridRows: RowSpec[] = [
    {
      id: 'windowSnap.grid.enabled',
      node: (
        <ToggleRow
          label={t('windowSnap.settings.gridEnabled')}
          isSelected={snap.grid !== null}
          onChange={(enabled) => {
            write((current) => ({
              ...current,
              grid: enabled ? normaliseSnapGrid(STARTER_GRID) : null,
            }));
          }}
        />
      ),
    },
  ];
  if (snap.grid !== null) {
    const grid = snap.grid;
    gridRows.push(
      {
        id: 'windowSnap.grid.rows',
        node: (
          <SegmentedRow
            label={t('windowSnap.settings.rows')}
            items={segments(range(WINDOW_SNAP_BOUNDS.rows))}
            value={String(grid.rows)}
            onChange={(value) => {
              setGrid({ rows: Number(value) });
            }}
          />
        ),
      },
      {
        id: 'windowSnap.grid.cols',
        node: (
          <SegmentedRow
            label={t('windowSnap.settings.cols')}
            items={segments(range(WINDOW_SNAP_BOUNDS.cols))}
            value={String(grid.cols)}
            onChange={(value) => {
              setGrid({ cols: Number(value) });
            }}
          />
        ),
      },
      {
        id: 'windowSnap.grid.gap',
        node: (
          <SliderRow
            label={t('windowSnap.settings.gap')}
            value={grid.gap}
            minValue={WINDOW_SNAP_BOUNDS.gap.min}
            maxValue={WINDOW_SNAP_BOUNDS.gap.max}
            step={2}
            format={(value) => t('windowSnap.settings.px', { value })}
            onChange={(gap) => {
              setGrid({ gap });
            }}
            onChangeEnd={(gap) => {
              setGrid({ gap });
            }}
          />
        ),
      },
    );
  }

  return (
    <>
      <Section
        title={t('windowSnap.settings.zones')}
        description={t('windowSnap.settings.zonesBody', { max })}
        visible={everything}
        rows={[
          {
            id: 'windowSnap.count',
            node: (
              <ValueRow
                label={t('windowSnap.settings.chosen')}
                value={t('windowSnap.settings.count', { count, max })}
              />
            ),
          },
          ...zoneRows,
        ]}
      />
      <Section
        title={t('windowSnap.settings.grid')}
        description={t('windowSnap.settings.gridBody')}
        visible={everything}
        rows={gridRows}
      />
    </>
  );
}

/** What a fresh document reads as, for tests and stories. */
export const windowSnapDefaults = defaultWindowSnapSettings;
