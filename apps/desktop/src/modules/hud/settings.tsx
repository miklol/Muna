import {
  type BrightnessMonitor,
  commands,
  defaultHudSettings,
  type HudSettings,
  type OsdState,
  readHudSettings,
  type ScrollOnStrip,
  writeHudSettings,
} from '@muna/contracts';
import { EmptyState, type SegmentedControlItem } from '@muna/ui';
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
import { useHudStore } from './hud-store';
import { useHudSubscription } from './use-hud';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/** Message key for the flyout status row, from the tracker's view of the Windows flyout. */
export const flyoutStatusKey = (
  osd: OsdState | undefined,
):
  | 'hud.settings.flyoutSuppressed'
  | 'hud.settings.flyoutNative'
  | 'hud.settings.flyoutUnavailable' => {
  switch (osd) {
    case 'suppressed':
      return 'hud.settings.flyoutSuppressed';
    case 'native':
      return 'hud.settings.flyoutNative';
    case 'unavailable':
    case undefined:
      return 'hud.settings.flyoutUnavailable';
  }
};

const ignoreRefusal = () => {
  // The platform refused or the device vanished; the next HudStateChanged shows what is true.
};

const brightnessRow = (monitor: BrightnessMonitor, format: (value: number) => string): RowSpec => ({
  id: `hud.brightness.${monitor.id}`,
  node: (
    <SliderRow
      label={monitor.name}
      value={monitor.percent}
      minValue={0}
      maxValue={100}
      format={format}
      onChange={() => {
        // DDC/CI takes ~50 ms per call: the value is written once on release.
      }}
      onChangeEnd={(percent) => {
        void commands.hudSetBrightness(monitor.id, percent).catch(ignoreRefusal);
      }}
    />
  ),
});

/**
 * Settings → Volume and brightness (docs/modules/hud.md "Settings"): the Windows flyout
 * switch, what the wheel does over the strip, the level text, and the levels the platform can
 * set. Preference writes go through the shared editor so they save like any other setting and
 * reach Rust, which applies the flyout state; level changes go straight to the HUD commands
 * and come back as `HudStateChanged`.
 */
export function HudSettingsPane() {
  const { t, i18n } = useTranslation();
  const { settings, update } = useSettingsEditor();
  useHudSubscription();
  const state = useHudStore((store) => store.state);
  const hud = readHudSettings(settings);

  const write = (recipe: (current: HudSettings) => HudSettings) => {
    update((current) => writeHudSettings(current, recipe(readHudSettings(current))));
  };

  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  const formatPercent = (value: number) => percent.format(value / 100);

  const scrollItems: SegmentedControlItem<ScrollOnStrip>[] = [
    { id: 'panel', label: t('hud.settings.scrollPanel') },
    { id: 'volume', label: t('hud.settings.scrollVolume') },
  ];

  const monitors = state?.monitors ?? [];
  const levelRows: RowSpec[] = [];
  if (state?.volume !== null && state?.volume !== undefined) {
    const { volume } = state;
    levelRows.push({
      id: 'hud.mute',
      node: (
        <ToggleRow
          label={t('hud.settings.mute')}
          description={t('hud.settings.muteBody')}
          isSelected={volume.muted}
          onChange={(muted) => {
            void commands.hudSetMuted(muted).catch(ignoreRefusal);
          }}
        />
      ),
    });
  }
  if (state?.micMuted !== null && state?.micMuted !== undefined) {
    const { micMuted } = state;
    levelRows.push({
      id: 'hud.micMute',
      node: (
        <ToggleRow
          label={t('hud.settings.micMute')}
          description={t('hud.settings.micMuteBody')}
          isSelected={micMuted}
          onChange={(muted) => {
            void commands.hudSetMicMuted(muted).catch(ignoreRefusal);
          }}
        />
      ),
    });
  }

  return (
    <>
      <Section
        title={t('hud.settings.flyout')}
        visible={everything}
        rows={[
          {
            id: 'hud.replaceSystemFlyout',
            node: (
              <ToggleRow
                label={t('hud.settings.replaceSystemFlyout')}
                description={t('hud.settings.replaceSystemFlyoutBody')}
                isSelected={hud.replaceSystemFlyout}
                onChange={(replaceSystemFlyout) => {
                  write((current) => ({ ...current, replaceSystemFlyout }));
                }}
              />
            ),
          },
          {
            id: 'hud.flyoutState',
            node: (
              <ValueRow
                label={t('hud.settings.flyoutState')}
                value={t(flyoutStatusKey(state?.osd))}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('hud.settings.strip')}
        visible={everything}
        rows={[
          {
            id: 'hud.scrollOnStrip',
            node: (
              <SegmentedRow
                label={t('hud.settings.scrollOnStrip')}
                description={t('hud.settings.scrollOnStripBody')}
                items={scrollItems}
                value={hud.scrollOnStrip}
                onChange={(scrollOnStrip) => {
                  write((current) => ({ ...current, scrollOnStrip }));
                }}
              />
            ),
          },
          {
            id: 'hud.showLevelText',
            node: (
              <ToggleRow
                label={t('hud.settings.showLevelText')}
                description={t('hud.settings.showLevelTextBody')}
                isSelected={hud.showLevelText}
                onChange={(showLevelText) => {
                  write((current) => ({ ...current, showLevelText }));
                }}
              />
            ),
          },
        ]}
      />
      {levelRows.length > 0 && (
        <Section title={t('hud.settings.levels')} visible={everything} rows={levelRows} />
      )}
      {monitors.length > 0 ? (
        <Section
          title={t('hud.settings.brightness')}
          description={t('hud.settings.brightnessBody')}
          visible={everything}
          rows={monitors.map((monitor) => brightnessRow(monitor, formatPercent))}
        />
      ) : (
        <EmptyState
          title={t('hud.settings.brightness')}
          description={t('hud.settings.brightnessEmpty')}
        />
      )}
    </>
  );
}

/** What a fresh document reads as, for tests and stories. */
export const hudDefaults = defaultHudSettings;
