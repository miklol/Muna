import {
  commands,
  NOTES_AUTOSAVE_MS,
  type Note,
  type NoteContent,
  type NotesSnapshot,
} from '@muna/contracts';
import {
  Button,
  contentRecipe,
  EmptyState,
  IconButton,
  ListRow,
  SearchField,
  Text,
  TextArea,
  TextField,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import {
  ArrowLeft,
  Eye,
  FileWarning,
  FolderOpen,
  FolderX,
  PenLine,
  Pin,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { folderDisplayName, formatModified, noteById } from './format';
import { renderMarkdown } from './markdown-lite';
import { useNotesStore } from './notes-store';
import {
  createNote,
  openInbox,
  openNote,
  openNoteExternally,
  renameNote,
  revealNote,
  saveNote,
  searchNotes,
  useNotesCommand,
  useNotesSubscription,
  visibleNotes,
} from './use-notes';
import './notes.css';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** Keystrokes settle for this long before the folder is searched. */
const SEARCH_DEBOUNCE_MS = 150;

type View =
  | { kind: 'list' }
  | { kind: 'editor'; content: NoteContent; caretAtEnd: boolean }
  | { kind: 'tooLarge'; id: string; title: string };

type SaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'failed';

const openSettings = () => {
  void commands.openSettings().catch(() => {
    // Outside Tauri (tests, Storybook) there is no settings window.
  });
};

interface RowProps {
  note: Note;
  now: number;
  locale: string;
  onOpen: (note: Note) => void;
}

/** One note: its title, the first line, when it changed, and a pin glyph when it is pinned. */
function Row({ note, now, locale, onOpen }: RowProps) {
  const { t } = useTranslation();
  const description =
    note.excerpt !== ''
      ? note.excerpt
      : note.folder !== ''
        ? t('notes.inFolder', { folder: note.folder })
        : undefined;
  return (
    <li className="notes-row" data-pinned={note.pinned || undefined}>
      <ListRow
        label={note.title}
        {...(description === undefined ? {} : { description })}
        trailing={
          <span className="notes-row__trailing">
            {note.pinned && (
              <Pin size={12} strokeWidth={ICON_STROKE} aria-label={t('notes.pinned')} />
            )}
            <Text as="time" variant="caption" tone="tertiary" tabular>
              {formatModified(note.modifiedMs, now, locale)}
            </Text>
          </span>
        }
        onPress={() => {
          onOpen(note);
        }}
      />
    </li>
  );
}

interface ListProps {
  snapshot: NotesSnapshot;
  now: number;
  locale: string;
  onOpen: (note: Note) => void;
  onCreate: (title: string) => void;
}

/** The search field or the new-note title field, the rows, and the count. */
function List({ snapshot, now, locale, onOpen, onCreate }: ListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const headRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') return;
    let stale = false;
    const timer = window.setTimeout(() => {
      void searchNotes(trimmed).then((ids) => {
        if (!stale) setHits(ids);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  // The title field appears on *New note*; the caret goes straight into it.
  useEffect(() => {
    if (creating) headRef.current?.querySelector('input')?.focus();
  }, [creating]);

  const search = (next: string) => {
    setQuery(next);
    if (next.trim() === '') setHits(null);
  };

  const rows = visibleNotes(snapshot, hits);
  const searching = hits !== null;

  let body;
  if (rows.length > 0) {
    body = (
      <ol className="notes-list__rows">
        {rows.map((note) => (
          <Row key={note.id} note={note} now={now} locale={locale} onOpen={onOpen} />
        ))}
      </ol>
    );
  } else if (searching) {
    body = (
      <EmptyState
        className="notes-empty"
        icon={<StickyNote size={24} strokeWidth={1.5} />}
        title={t('notes.noResults.title')}
        description={t('notes.noResults.body')}
      />
    );
  } else {
    body = (
      <EmptyState
        className="notes-empty"
        icon={<StickyNote size={24} strokeWidth={1.5} />}
        title={t('notes.empty.title')}
        description={t('notes.empty.body')}
      />
    );
  }

  return (
    <section className="notes-list" aria-label={t('notes.list')}>
      <header className="notes-list__head" ref={headRef}>
        {creating ? (
          <>
            <TextField
              aria-label={t('notes.newTitle')}
              placeholder={t('notes.newTitlePlaceholder')}
              className="notes-list__field"
              onSubmit={(title) => {
                setCreating(false);
                onCreate(title);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCreating(false);
              }}
            />
            <IconButton
              aria-label={t('notes.cancel')}
              onPress={() => {
                setCreating(false);
              }}
            >
              <X strokeWidth={ICON_STROKE} />
            </IconButton>
          </>
        ) : (
          <>
            <SearchField
              aria-label={t('notes.search')}
              placeholder={t('notes.searchPlaceholder')}
              clearLabel={t('notes.clearSearch')}
              className="notes-list__field"
              value={query}
              onChange={search}
            />
            <IconButton
              aria-label={t('notes.new')}
              onPress={() => {
                setCreating(true);
              }}
            >
              <Plus strokeWidth={ICON_STROKE} />
            </IconButton>
          </>
        )}
      </header>
      {body}
      <Text as="p" variant="caption" tone="tertiary" tabular className="notes-list__count">
        {t('notes.count', { count: rows.length })}
      </Text>
    </section>
  );
}

interface EditorProps {
  content: NoteContent;
  /** The list's row for this note (pins, the folder); missing until the next snapshot. */
  note: Note | undefined;
  caretAtEnd: boolean;
  now: number;
  locale: string;
  onBack: () => void;
  onPin: (pinned: boolean) => void;
  onDelete: () => void;
  onRenamed: (note: Note, body: string) => void;
}

/**
 * The editor for one note: the title and its actions above a plain text area (or the light
 * Markdown preview), the save state underneath. Text autosaves 600 ms after the last change,
 * on blur, and when the editor closes; a file that changed in another app since it was loaded
 * is reloaded instead of overwritten, and one line says so.
 */
function Editor({
  content,
  note,
  caretAtEnd,
  now,
  locale,
  onBack,
  onPin,
  onDelete,
  onRenamed,
}: EditorProps) {
  const { t } = useTranslation();
  const [body, setBody] = useState(content.body);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [renaming, setRenaming] = useState(false);
  const [modifiedMs, setModifiedMs] = useState(content.modifiedMs);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const headRef = useRef<HTMLElement>(null);
  // What the next save writes, read at save time so a timer never sends a stale body.
  const draft = useRef({ body: content.body, base: content.modifiedMs, dirty: false });
  const saving = useRef(false);
  const timer = useRef<number | null>(null);
  const discard = useRef(false);
  const pinned = note?.pinned ?? false;

  useEffect(() => {
    if (!caretAtEnd) return;
    const element = textAreaRef.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [caretAtEnd]);

  // The rename field replaces the title on *Rename*; the caret goes straight into it.
  useEffect(() => {
    if (renaming) headRef.current?.querySelector('input')?.select();
  }, [renaming]);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const save = async (): Promise<void> => {
    clearTimer();
    if (!draft.current.dirty || saving.current) return;
    saving.current = true;
    const sent = draft.current.body;
    setStatus('saving');
    const result = await saveNote({
      id: content.id,
      body: sent,
      baseModifiedMs: draft.current.base,
    });
    saving.current = false;
    if (result.status === 'ok') {
      draft.current.base = result.data.modifiedMs;
      setModifiedMs(result.data.modifiedMs);
      if (draft.current.body === sent) {
        draft.current.dirty = false;
        setStatus('saved');
      } else {
        // Typing continued while the write ran; the newer text follows right away.
        void save();
      }
      return;
    }
    if (result.failure === 'conflict') {
      const fresh = await openNote(content.id);
      if (fresh.status === 'ok') {
        draft.current = { body: fresh.data.body, base: fresh.data.modifiedMs, dirty: false };
        setBody(fresh.data.body);
        setModifiedMs(fresh.data.modifiedMs);
        setStatus('conflict');
        return;
      }
    }
    setStatus('failed');
  };

  const change = (next: string) => {
    setBody(next);
    draft.current.body = next;
    draft.current.dirty = true;
    clearTimer();
    timer.current = window.setTimeout(() => {
      void save();
    }, NOTES_AUTOSAVE_MS);
  };

  // Closing the editor (back, another note, the panel) writes what is pending, once.
  useEffect(
    () => () => {
      clearTimer();
      if (discard.current || !draft.current.dirty || saving.current) return;
      void saveNote({
        id: content.id,
        body: draft.current.body,
        baseModifiedMs: draft.current.base,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on unmount
    [],
  );

  const rename = async (title: string) => {
    setRenaming(false);
    if (title === content.title) return;
    await save();
    const result = await renameNote(content.id, title);
    if (result.status === 'ok') {
      draft.current.dirty = false;
      onRenamed(result.data, draft.current.body);
    } else {
      setStatus('failed');
    }
  };

  let statusText: string | null;
  switch (status) {
    case 'saving':
      statusText = t('notes.saving');
      break;
    case 'saved':
      statusText = t('notes.saved');
      break;
    case 'conflict':
      statusText = t('notes.conflict');
      break;
    case 'failed':
      statusText = t('notes.saveFailed');
      break;
    case 'idle':
      statusText = t('notes.edited', { time: formatModified(modifiedMs, now, locale) });
      break;
  }

  return (
    <section className="notes-editor" aria-label={content.title}>
      <header className="notes-editor__head" ref={headRef}>
        <IconButton aria-label={t('notes.back')} onPress={onBack}>
          <ArrowLeft strokeWidth={ICON_STROKE} />
        </IconButton>
        {renaming ? (
          <TextField
            aria-label={t('notes.renameTitle')}
            placeholder={t('notes.renamePlaceholder')}
            className="notes-editor__rename"
            defaultValue={content.title}
            onSubmit={(title) => {
              void rename(title);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRenaming(false);
            }}
            onBlur={() => {
              setRenaming(false);
            }}
          />
        ) : (
          <Text
            as="h2"
            variant="body"
            weight={600}
            truncate={1}
            className="notes-editor__title"
            title={content.title}
          >
            {content.title}
          </Text>
        )}
        <span className="notes-editor__actions">
          <IconButton
            aria-label={t('notes.rename')}
            isDisabled={renaming}
            onPress={() => {
              setRenaming(true);
            }}
          >
            <PenLine strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton
            aria-label={
              pinned
                ? t('notes.unpin', { title: content.title })
                : t('notes.pin', { title: content.title })
            }
            aria-pressed={pinned}
            isActive={pinned}
            onPress={() => {
              onPin(!pinned);
            }}
          >
            <Pin strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton
            aria-label={mode === 'edit' ? t('notes.preview') : t('notes.edit')}
            aria-pressed={mode === 'preview'}
            isActive={mode === 'preview'}
            onPress={() => {
              setMode(mode === 'edit' ? 'preview' : 'edit');
            }}
          >
            <Eye strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton
            aria-label={t('notes.reveal')}
            onPress={() => {
              void revealNote(content.id);
            }}
          >
            <FolderOpen strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton
            aria-label={t('notes.delete')}
            onPress={() => {
              discard.current = true;
              clearTimer();
              onDelete();
            }}
          >
            <Trash2 strokeWidth={ICON_STROKE} />
          </IconButton>
        </span>
      </header>
      {mode === 'edit' ? (
        <TextArea
          aria-label={t('notes.body')}
          placeholder={t('notes.bodyPlaceholder')}
          className="notes-editor__body"
          value={body}
          onChange={change}
          onBlur={() => {
            void save();
          }}
          textAreaRef={textAreaRef}
        />
      ) : (
        <div className="notes-editor__preview notes-md" aria-label={t('notes.preview')}>
          {body.trim() === '' ? (
            <Text as="p" variant="footnote" tone="tertiary">
              {t('notes.previewEmpty')}
            </Text>
          ) : (
            renderMarkdown(body)
          )}
        </div>
      )}
      <Text
        as="p"
        role="status"
        variant="caption"
        tone={status === 'conflict' || status === 'failed' ? 'secondary' : 'tertiary'}
        className="notes-editor__status"
        data-status={status}
      >
        {statusText}
      </Text>
    </section>
  );
}

interface ProblemProps {
  snapshot: NotesSnapshot;
}

/** The folder is missing or cannot be read: the panel says which folder and where to fix it. */
function Problem({ snapshot }: ProblemProps) {
  const { t } = useTranslation();
  const kind = snapshot.problem ?? 'missing';
  const folder = folderDisplayName(snapshot.folder);
  return (
    <EmptyState
      className="notes-empty"
      icon={<FolderX size={24} strokeWidth={1.5} />}
      title={t(`notes.problem.${kind}.title`)}
      description={t(`notes.problem.${kind}.body`, { folder })}
      action={
        <Button variant="secondary" onPress={openSettings}>
          {t(`notes.problem.${kind}.action`)}
        </Button>
      }
    />
  );
}

/**
 * The notes panel (docs/modules/notes.md "Panel"): the folder's notes, pinned first then newest,
 * with search and a new-note field above them; a row opens the editor in place. The
 * `notes.quickNote` action opens *Inbox* with the caret at the end. Nothing polls: the list is a
 * snapshot the Rust side rescans on request and after every write.
 */
export function NotesPanel() {
  const { t, i18n } = useTranslation();
  useNotesSubscription();
  const snapshot = useNotesStore((store) => store.snapshot);
  const now = useNotesStore((store) => store.receivedAt);
  const quickNotePending = useNotesStore((store) => store.quickNotePending);
  const consumeQuickNote = useNotesStore((store) => store.consumeQuickNote);
  const send = useNotesCommand();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');
  const [view, setView] = useState<View>({ kind: 'list' });
  const locale = i18n.resolvedLanguage ?? i18n.language;

  useEffect(() => {
    if (!quickNotePending) return;
    consumeQuickNote();
    void openInbox().then((result) => {
      if (result.status === 'ok') {
        setView({ kind: 'editor', content: result.data, caretAtEnd: true });
      }
    });
  }, [quickNotePending, consumeQuickNote]);

  const open = (note: Note) => {
    void openNote(note.id).then((result) => {
      if (result.status === 'ok') {
        setView({ kind: 'editor', content: result.data, caretAtEnd: false });
      } else if (result.failure === 'tooLarge') {
        setView({ kind: 'tooLarge', id: note.id, title: note.title });
      } else {
        // The file went away since the list was drawn; the list catches up.
        send({ kind: 'refresh' });
      }
    });
  };

  const create = (title: string) => {
    void createNote(title).then((result) => {
      if (result.status === 'ok') {
        setView({ kind: 'editor', content: result.data, caretAtEnd: true });
      }
    });
  };

  const backToList = () => {
    setView({ kind: 'list' });
  };

  let body;
  switch (view.kind) {
    case 'list':
      if (snapshot === null) return null;
      body =
        snapshot.problem === null ? (
          <List snapshot={snapshot} now={now} locale={locale} onOpen={open} onCreate={create} />
        ) : (
          <Problem snapshot={snapshot} />
        );
      break;
    case 'editor':
      body = (
        <Editor
          key={view.content.id}
          content={view.content}
          note={noteById(snapshot, view.content.id)}
          caretAtEnd={view.caretAtEnd}
          now={now}
          locale={locale}
          onBack={backToList}
          onPin={(pinned) => {
            send({ kind: 'pin', id: view.content.id, pinned });
          }}
          onDelete={() => {
            send({ kind: 'delete', id: view.content.id });
            backToList();
          }}
          onRenamed={(note, text) => {
            setView({
              kind: 'editor',
              content: { id: note.id, title: note.title, body: text, modifiedMs: note.modifiedMs },
              caretAtEnd: false,
            });
          }}
        />
      );
      break;
    case 'tooLarge': {
      const id = view.id;
      body = (
        <section className="notes-editor" aria-label={view.title}>
          <header className="notes-editor__head">
            <IconButton aria-label={t('notes.back')} onPress={backToList}>
              <ArrowLeft strokeWidth={ICON_STROKE} />
            </IconButton>
            <Text as="h2" variant="body" weight={600} truncate={1} className="notes-editor__title">
              {view.title}
            </Text>
          </header>
          <EmptyState
            className="notes-empty"
            icon={<FileWarning size={24} strokeWidth={1.5} />}
            title={t('notes.tooLarge.title')}
            description={t('notes.tooLarge.body')}
            action={
              <Button
                variant="secondary"
                onPress={() => {
                  void openNoteExternally(id);
                }}
              >
                {t('notes.tooLarge.action')}
              </Button>
            }
          />
        </section>
      );
      break;
    }
  }

  return (
    <motion.div
      className="notes-panel"
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      {body}
    </motion.div>
  );
}
