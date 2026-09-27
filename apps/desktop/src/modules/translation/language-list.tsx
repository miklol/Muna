import { TRANSLATION_AUTO } from '@muna/contracts';
import { ListRow, SearchField, Text } from '@muna/ui';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import { filterLanguages, languageName } from './languages';
import './translation.css';

export interface LanguageListProps {
  /** The tag currently chosen; its row carries a check. */
  value: string;
  /** Offer *Detect language* (`auto`) at the top — the source side only. */
  allowAuto?: boolean;
  onChange: (tag: string) => void;
  /**
   * Put the caret in the search field when the list mounts: the panel's picker, which the user
   * just asked for by pressing a language. The settings pane's inline list leaves focus where
   * it is.
   */
  focusOnMount?: boolean;
  className?: string;
}

/**
 * A searchable list of the languages the panel offers (docs/modules/translation.md), named in
 * the UI's own locale. One row per language, the chosen one checked; the search narrows by name
 * or tag as you type. Used by the panel's pickers and inline in the settings pane.
 */
export function LanguageList({
  value,
  allowAuto = false,
  onChange,
  focusOnMount = false,
  className,
}: LanguageListProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focusOnMount) return;
    root.current?.querySelector('input')?.focus();
  }, [focusOnMount]);

  const matches = filterLanguages(query, locale);
  const autoLabel = t('translation.auto');
  const showAuto =
    allowAuto &&
    (query.trim() === '' ||
      autoLabel.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)));

  const row = (tag: string, label: string) => (
    <li key={tag} className="translation-list__item">
      <ListRow
        label={label}
        className="translation-list__row"
        trailing={
          tag === value ? (
            <span className="translation-list__check" aria-hidden="true">
              <Check size={16} strokeWidth={1.75} />
            </span>
          ) : undefined
        }
        onPress={() => {
          onChange(tag);
        }}
        {...(tag === value ? { 'aria-current': 'true' } : {})}
      />
    </li>
  );

  return (
    <div
      ref={root}
      className={className === undefined ? 'translation-list' : `translation-list ${className}`}
    >
      <SearchField
        aria-label={t('translation.list.search')}
        placeholder={t('translation.list.search')}
        clearLabel={t('translation.list.clear')}
        className="translation-list__search"
        value={query}
        onChange={setQuery}
      />
      {!showAuto && matches.length === 0 ? (
        <Text as="p" variant="footnote" tone="secondary" className="translation-list__empty">
          {t('translation.list.empty')}
        </Text>
      ) : (
        <ul className="translation-list__rows" aria-label={t('translation.list.label')}>
          {showAuto && row(TRANSLATION_AUTO, autoLabel)}
          {matches.map((tag) => row(tag, languageName(tag, locale)))}
        </ul>
      )}
    </div>
  );
}
