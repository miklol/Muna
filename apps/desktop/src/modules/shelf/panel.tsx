import type { ShelfItem } from '@muna/contracts';
import {
  Button,
  contentExitTransition,
  contentRecipe,
  EmptyState,
  IconButton,
  Text,
  TextField,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import {
  CircleCheck,
  ClipboardPaste,
  Copy,
  Folder,
  FolderSearch,
  Inbox,
  Link,
  SquareCheckBig,
  SquareDashed,
  TextIcon,
  Trash2,
  Unlink,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useDragOut } from '../../lib/drag-out';
import './shelf.css';
import { formatSize, isLink, orderedItems, targetIds, useShelfStore } from './shelf-store';
import { useShelfCommand, useShelfSubscription, useShelfThumbnail } from './use-shelf';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;
/** The placeholder glyph inside a 64 px tile. */
const PLACEHOLDER_SIZE = 28;
/** How long the status line says "Copied" after a copy. */
const COPIED_MS = 1500;

const glyphProps = { size: PLACEHOLDER_SIZE, strokeWidth: 1.5, 'aria-hidden': true } as const;

/**
 * The picture in a tile: Explorer's thumbnail when Rust has one, else a placeholder that says
 * what the item is — its extension, a folder, a link or a text glyph — and a broken link once
 * the file is gone.
 */
function TilePicture({ item }: { readonly item: ShelfItem }) {
  const { t } = useTranslation();
  const thumbnail = useShelfThumbnail(item);
  if (item.missing) {
    return (
      <span className="shelf-tile__placeholder" data-missing>
        <Unlink {...glyphProps} />
      </span>
    );
  }
  if (thumbnail !== null) {
    return <img className="shelf-tile__thumbnail" src={thumbnail} alt="" draggable={false} />;
  }
  if (item.kind === 'text') {
    return (
      <span className="shelf-tile__placeholder" data-kind="text">
        {isLink(item.preview) ? <Link {...glyphProps} /> : <TextIcon {...glyphProps} />}
      </span>
    );
  }
  if (item.isFolder) {
    return (
      <span className="shelf-tile__placeholder" data-kind="folder">
        <Folder {...glyphProps} />
      </span>
    );
  }
  return (
    <span className="shelf-tile__placeholder" data-kind="file">
      <Text as="span" variant="caption" weight={600} className="shelf-tile__extension">
        {item.extension === null ? t('shelf.file') : item.extension.toUpperCase()}
      </Text>
    </span>
  );
}

interface TileProps {
  readonly item: ShelfItem;
  readonly selected: boolean;
  /** The one tile in the tab order (roving tabindex). */
  readonly focusable: boolean;
  /** Ids a drag from this tile carries: the selection when it is part of it, else itself. */
  readonly dragIds: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly onOpen: (item: ShelfItem) => void;
  readonly onFocus: (id: string) => void;
  /** `AnimatePresence` (popLayout) measures the leaving tile through this. */
  readonly ref?: Ref<HTMLLIElement>;
}

/**
 * One item: a 64 px picture with the name under it. Click toggles selection, double-click
 * opens, a press that travels 6 px starts the OLE drag (`useDragOut`); the grid handles the
 * keyboard. The selection circle is decorative; `aria-selected` says it.
 */
function ShelfTile({
  item,
  selected,
  focusable,
  dragIds,
  onToggle,
  onOpen,
  onFocus,
  ref,
}: TileProps) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReduceMotion();
  const layoutSpring = useMotionPreset('layout');
  const enterSpring = useMotionPreset('content');
  const dragRef = useRef<HTMLLIElement | null>(null);
  const setRefs = useCallback(
    (node: HTMLLIElement | null) => {
      dragRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref !== undefined && ref !== null) {
        ref.current = node;
      }
    },
    [ref],
  );
  // Keyed on the ids' text: an unselected tile gets a fresh `[id]` every render, and
  // `useDragOut` re-arms whenever the request's identity changes.
  const idsKey = dragIds.join('\n');
  const request = useMemo(() => ({ kind: 'shelf' as const, ids: idsKey.split('\n') }), [idsKey]);
  const dragging = useDragOut(dragRef, item.missing ? null : request);

  const locale = i18n.resolvedLanguage ?? i18n.language;
  let description: string;
  if (item.missing) {
    description = t('shelf.missing');
  } else if (item.kind === 'text') {
    description = item.preview ?? '';
  } else {
    description = [
      item.isFolder ? t('shelf.folder') : null,
      formatSize(item.size, locale),
      item.copied ? t('shelf.copied') : null,
    ]
      .filter((part) => part !== null)
      .join(' · ');
  }

  const enterFrom = reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFrom;
  const visible = reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible;
  const exitTo = {
    ...(reduceMotion ? contentRecipe.reducedExitTo : contentRecipe.exitTo),
    transition: contentExitTransition,
  };

  return (
    <motion.li
      ref={setRefs}
      layout={!reduceMotion}
      initial={enterFrom}
      animate={visible}
      exit={exitTo}
      transition={{ ...enterSpring, layout: layoutSpring }}
      role="option"
      aria-selected={selected}
      aria-label={item.name}
      title={description === '' ? undefined : description}
      tabIndex={focusable ? 0 : -1}
      className="shelf-tile"
      data-id={item.id}
      data-selected={selected || undefined}
      data-missing={item.missing || undefined}
      data-dragging={dragging || undefined}
      onClick={(event: MouseEvent) => {
        // The second click of a double-click is not a toggle; `onDoubleClick` opens instead.
        if (event.detail > 1) return;
        onToggle(item.id);
      }}
      onDoubleClick={() => {
        onOpen(item);
      }}
      onFocus={() => {
        onFocus(item.id);
      }}
    >
      <span className="shelf-tile__picture">
        <TilePicture item={item} />
        <span className="shelf-tile__check" aria-hidden="true">
          <CircleCheck size={18} strokeWidth={2} />
        </span>
      </span>
      <Text as="span" variant="footnote" truncate={2} className="shelf-tile__name">
        {item.name}
      </Text>
    </motion.li>
  );
}

/** How many tiles one row of the grid holds right now, from the resolved grid template. */
const columnsOf = (grid: HTMLElement): number => {
  const template = getComputedStyle(grid).gridTemplateColumns;
  const count = template.split(' ').filter((track) => track.length > 0).length;
  return Math.max(1, count);
};

const isOpenable = (item: ShelfItem): boolean => item.kind === 'file' && !item.missing;

/**
 * The Shelf panel (docs/modules/shelf.md): a paste field for snippets, select-all, copy and
 * remove, a status line with the count, then the grid of 64 px tiles. Tiles can be
 * multi-selected and dragged out to any app; missing files show a broken-link state and go
 * together with *Remove missing*. Tiles slide with the `layout` spring; the panel keeps no
 * timers while idle.
 */
export function ShelfPanel() {
  const { t } = useTranslation();
  useShelfSubscription();
  const snapshot = useShelfStore((store) => store.snapshot);
  const selected = useShelfStore((store) => store.selected);
  const toggle = useShelfStore((store) => store.toggle);
  const select = useShelfStore((store) => store.select);
  const clearSelection = useShelfStore((store) => store.clearSelection);
  const send = useShelfCommand();
  const [draft, setDraft] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const gridRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  const items = useMemo(() => orderedItems(snapshot?.items ?? []), [snapshot]);
  const missing = items.filter((item) => item.missing);
  const allSelected = items.length > 0 && selected.length === items.length;
  const focusable =
    focusedId !== null && items.some((item) => item.id === focusedId)
      ? focusedId
      : (items[0]?.id ?? null);
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const actionItems = selectedItems.length > 0 ? selectedItems : items;
  const canCopy = actionItems.some((item) => !item.missing);
  const canReveal = selectedItems.some(isOpenable);

  const open = useCallback(
    (item: ShelfItem) => {
      if (isOpenable(item)) void send({ kind: 'open', id: item.id });
    },
    [send],
  );
  const focusTile = (id: string) => {
    setFocusedId(id);
    gridRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();
  };
  const remove = (ids: readonly string[]) => {
    if (ids.length > 0) void send({ kind: 'remove', ids: [...ids] });
  };
  const copy = (candidates: readonly ShelfItem[]) => {
    const ids = candidates.filter((item) => !item.missing).map((item) => item.id);
    if (ids.length === 0) return;
    void send({ kind: 'copy', ids }).then((ok) => {
      if (ok) setCopied(true);
    });
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const grid = gridRef.current;
    const index = items.findIndex((item) => item.id === focusable);
    const focused = items[index];
    if (grid === null || focused === undefined) return;
    const columns = columnsOf(grid);
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(items.length - 1, index + 1);
        break;
      case 'ArrowLeft':
        next = Math.max(0, index - 1);
        break;
      case 'ArrowDown':
        next = Math.min(items.length - 1, index + columns);
        break;
      case 'ArrowUp':
        next = Math.max(0, index - columns);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case ' ':
        toggle(focused.id);
        break;
      case 'Enter':
        open(focused);
        break;
      case 'Delete':
      case 'Backspace':
        remove(targetIds(selected, focused.id));
        break;
      case 'a':
        if (!(event.ctrlKey || event.metaKey)) return;
        select(items.map((item) => item.id));
        break;
      case 'Escape':
        if (selected.length === 0) return;
        clearSelection();
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = next === null ? undefined : items[next];
    if (target !== undefined) focusTile(target.id);
  };

  if (snapshot === null) return null;

  let status: string;
  if (copied) {
    status = t('shelf.copiedNotice');
  } else if (selected.length > 0) {
    status = t('shelf.selected', { count: selected.length, total: items.length });
  } else {
    status = t('shelf.items', { count: items.length });
  }

  return (
    <div className="shelf-panel">
      <div className="shelf-toolbar">
        <TextField
          aria-label={t('shelf.paste')}
          placeholder={t('shelf.paste')}
          className="shelf-paste"
          leading={<ClipboardPaste size={16} strokeWidth={ICON_STROKE} />}
          value={draft}
          onChange={setDraft}
          onSubmit={(value) => {
            if (value.trim() === '') return;
            void send({ kind: 'addText', text: value }).then((ok) => {
              if (ok) setDraft('');
            });
          }}
        />
        <div className="shelf-toolbar__actions">
          <IconButton
            aria-label={allSelected ? t('shelf.clearSelection') : t('shelf.selectAll')}
            aria-pressed={allSelected}
            isActive={allSelected}
            isDisabled={items.length === 0}
            onPress={() => {
              if (allSelected) {
                clearSelection();
              } else {
                select(items.map((item) => item.id));
              }
            }}
          >
            {allSelected ? (
              <SquareCheckBig strokeWidth={ICON_STROKE} />
            ) : (
              <SquareDashed strokeWidth={ICON_STROKE} />
            )}
          </IconButton>
          <IconButton
            aria-label={
              selectedItems.length > 0
                ? t('shelf.copySelected', { count: selectedItems.length })
                : t('shelf.copyAll')
            }
            isDisabled={!canCopy}
            onPress={() => {
              copy(actionItems);
            }}
          >
            <Copy strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton
            aria-label={
              selectedItems.length > 0
                ? t('shelf.removeSelected', { count: selectedItems.length })
                : t('shelf.clear')
            }
            isDisabled={items.length === 0}
            onPress={() => {
              if (selectedItems.length > 0) {
                remove(selected);
              } else {
                void send({ kind: 'clear' });
              }
            }}
          >
            <Trash2 strokeWidth={ICON_STROKE} />
          </IconButton>
        </div>
      </div>
      <div className="shelf-status">
        <Text
          as="p"
          variant="footnote"
          tone="secondary"
          tabular
          aria-live="polite"
          className="shelf-status__count"
        >
          {status}
        </Text>
        {canReveal && (
          <Button
            variant="secondary"
            icon={<FolderSearch strokeWidth={ICON_STROKE} />}
            onPress={() => {
              void send({ kind: 'reveal', ids: selectedItems.filter(isOpenable).map((i) => i.id) });
            }}
          >
            {t('shelf.reveal')}
          </Button>
        )}
        {missing.length > 0 && (
          <Button
            variant="secondary"
            icon={<Unlink strokeWidth={ICON_STROKE} />}
            onPress={() => {
              void send({ kind: 'removeMissing' });
            }}
          >
            {t('shelf.removeMissing', { count: missing.length })}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          className="shelf-empty"
          icon={<Inbox size={24} strokeWidth={1.5} />}
          title={t('shelf.empty')}
          description={t('shelf.emptyBody')}
        />
      ) : (
        <ul
          ref={gridRef}
          role="listbox"
          aria-multiselectable="true"
          aria-label={t('shelf.title')}
          className="shelf-grid"
          onKeyDown={onGridKeyDown}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {items.map((item) => (
              <ShelfTile
                key={item.id}
                item={item}
                selected={selected.includes(item.id)}
                focusable={item.id === focusable}
                dragIds={targetIds(selected, item.id)}
                onToggle={toggle}
                onOpen={open}
                onFocus={setFocusedId}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
