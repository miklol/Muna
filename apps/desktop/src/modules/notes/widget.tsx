import { widgetNote } from '@muna/contracts';
import { Text } from '@muna/ui';
import { FolderX, Pin, StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { formatModified } from './format';
import { useNotesStore } from './notes-store';
import { useNotesSubscription } from './use-notes';
import './notes.css';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/**
 * The notes card on the dashboard (docs/modules/notes.md "Widget"): the first pinned note's
 * title and first line — or, with nothing pinned, the newest note. Without a note, or with the
 * folder away, it says so in one line. A wide card adds when the note changed.
 */
export function NotesWidget({ span }: WidgetProps) {
  const { t, i18n } = useTranslation();
  useNotesSubscription();
  const snapshot = useNotesStore((store) => store.snapshot);
  const now = useNotesStore((store) => store.receivedAt);

  if (snapshot === null) return null;

  const note = snapshot.problem === null ? widgetNote(snapshot.notes) : null;
  if (note === null) {
    const problem = snapshot.problem !== null;
    return (
      <div className="notes-widget" data-empty data-problem={problem || undefined}>
        <span className="notes-widget__glyph">
          {problem ? (
            <FolderX strokeWidth={ICON_STROKE} />
          ) : (
            <StickyNote strokeWidth={ICON_STROKE} />
          )}
        </span>
        <Text as="p" variant="footnote" tone="secondary" className="notes-widget__note">
          {problem ? t('notes.widget.problem') : t('notes.widget.empty')}
        </Text>
      </div>
    );
  }

  const locale = i18n.resolvedLanguage ?? i18n.language;
  return (
    <div className="notes-widget" aria-label={t('notes.widget.label')}>
      <p className="notes-widget__title">
        {note.pinned && <Pin size={12} strokeWidth={ICON_STROKE} aria-label={t('notes.pinned')} />}
        <Text as="span" variant="footnote" weight={600} truncate={1}>
          {note.title}
        </Text>
      </p>
      {note.excerpt !== '' && (
        <Text
          as="p"
          variant="caption"
          tone="secondary"
          truncate={span === 2 ? 1 : 2}
          className="notes-widget__excerpt"
        >
          {note.excerpt}
        </Text>
      )}
      {span === 2 && (
        <Text as="p" variant="caption" tone="tertiary" tabular className="notes-widget__when">
          {t('notes.edited', { time: formatModified(note.modifiedMs, now, locale) })}
        </Text>
      )}
    </div>
  );
}
