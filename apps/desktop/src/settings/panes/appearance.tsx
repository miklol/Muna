import type { CSSProperties } from 'react';
import { RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import { useTranslation } from 'react-i18next';

import { type Accent, accents, isAccent } from '../../lib/appearance';
import { type RowFilter, Section, ToggleRow } from '../rows';
import { useSettingsEditor } from '../settings-editor';

interface PaneProps {
  visible: RowFilter;
}

const accentName = {
  blue: 'settings.appearance.accents.blue',
  cyan: 'settings.appearance.accents.cyan',
  green: 'settings.appearance.accents.green',
  orange: 'settings.appearance.accents.orange',
  red: 'settings.appearance.accents.red',
  purple: 'settings.appearance.accents.purple',
  yellow: 'settings.appearance.accents.yellow',
  pink: 'settings.appearance.accents.pink',
} as const satisfies Record<Accent, string>;

interface AccentPickerProps {
  value: string;
  onChange: (accent: Accent) => void;
}

/**
 * Radio group of 24 px swatches, one per `--accent-*` token. The selected swatch carries a
 * ring in the same colour; names come from the label, never from the colour alone.
 */
export function AccentPicker({ value, onChange }: AccentPickerProps) {
  const { t } = useTranslation();
  return (
    <RadioGroup
      aria-label={t('settings.appearance.accent')}
      orientation="horizontal"
      value={isAccent(value) ? value : 'blue'}
      onChange={(next) => {
        if (isAccent(next)) {
          onChange(next);
        }
      }}
      className="flex flex-wrap items-center gap-2"
    >
      {accents.map((accent) => (
        <RadioField
          key={accent}
          value={accent}
          aria-label={t(accentName[accent])}
          className="inline-flex"
        >
          <RadioButton
            className="settings-swatch"
            style={{ '--settings-swatch': `var(--accent-${accent})` } as CSSProperties}
          />
        </RadioField>
      ))}
    </RadioGroup>
  );
}

/** Appearance: accent colour and the app's own reduce-motion switch. */
export function AppearancePane({ visible }: PaneProps) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();

  return (
    <>
      <Section
        title={t('settings.appearance.accent')}
        description={t('settings.appearance.accentBody')}
        visible={visible}
        rows={[
          {
            id: 'appearance.accent',
            node: (
              <div className="px-3 py-2.5">
                <AccentPicker
                  value={settings.general.accent}
                  onChange={(accent) => {
                    update((current) => ({
                      ...current,
                      general: { ...current.general, accent },
                    }));
                  }}
                />
              </div>
            ),
          },
        ]}
      />
      <Section
        title={t('settings.appearance.accessibility')}
        description={t('settings.appearance.accessibilityBody')}
        visible={visible}
        rows={[
          {
            id: 'appearance.reduceMotion',
            node: (
              <ToggleRow
                label={t('settings.appearance.reduceMotion')}
                description={t('settings.appearance.reduceMotionBody')}
                isSelected={settings.general.reducedMotion === 'on'}
                onChange={(on) => {
                  update((current) => ({
                    ...current,
                    general: { ...current.general, reducedMotion: on ? 'on' : 'system' },
                  }));
                }}
              />
            ),
          },
          {
            id: 'appearance.increaseContrast',
            node: (
              <ToggleRow
                label={t('settings.appearance.increaseContrast')}
                description={t('settings.appearance.increaseContrastBody')}
                isSelected={settings.general.contrast === 'more'}
                onChange={(more) => {
                  update((current) => ({
                    ...current,
                    general: { ...current.general, contrast: more ? 'more' : 'system' },
                  }));
                }}
              />
            ),
          },
          {
            id: 'appearance.announceNotices',
            node: (
              <ToggleRow
                label={t('settings.appearance.announceNotices')}
                description={t('settings.appearance.announceNoticesBody')}
                isSelected={settings.general.announceNotices}
                onChange={(announceNotices) => {
                  update((current) => ({
                    ...current,
                    general: { ...current.general, announceNotices },
                  }));
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}
