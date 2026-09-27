import { defaultSettings, readTranslationSettings, TRANSLATION_AUTO } from '@muna/contracts';
import { Text } from '@muna/ui';
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSettings } from '../../lib/settings';
import type { WidgetProps } from '../registry';
import { languageName } from './languages';
import './translation.css';
import { useTranslationStore } from './translation-store';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/**
 * The translation card on the dashboard (docs/modules/dashboard.md "Widgets"): the language
 * pair the panel will use, or that the module is off and where to turn it on. It reads the
 * settings and the store only — no subscription, nothing leaves the machine from here.
 */
export function TranslationWidget(_props: WidgetProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const settings = readTranslationSettings(useSettings() ?? defaultSettings());
  const phase = useTranslationStore((store) => store.result.phase);

  const nameOf = (tag: string) =>
    tag === TRANSLATION_AUTO ? t('translation.auto') : languageName(tag, locale);

  let title: string;
  let caption: string;
  if (!settings.enabled) {
    title = t('translation.widget.off');
    caption = t('translation.widget.offBody');
  } else {
    title = t('translation.widget.pair', {
      source: nameOf(settings.source),
      target: nameOf(settings.target),
    });
    caption =
      phase === 'running' ? t('translation.widget.translating') : t('translation.widget.ready');
  }

  return (
    <div className="translation-widget" data-enabled={settings.enabled || undefined}>
      <span className="translation-widget__glyph" aria-hidden="true">
        <Languages size={16} strokeWidth={ICON_STROKE} />
      </span>
      <div className="translation-widget__text">
        <Text as="span" variant="footnote" weight={600} truncate={1}>
          {title}
        </Text>
        <Text as="span" variant="caption" tone="secondary" truncate={1}>
          {caption}
        </Text>
      </div>
    </div>
  );
}
