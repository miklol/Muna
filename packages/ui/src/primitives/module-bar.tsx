import {
  animate,
  LayoutGroup,
  motion,
  type MotionValue,
  motionValue,
  type Transition,
} from 'motion/react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { useMotionPreset } from '../motion/reduced-motion';
import './module-bar.css';
import { cx } from './shared';

export interface ModuleBarItem {
  /** Module id, stable across reorders. */
  readonly id: string;
  /** Accessible name; the bar shows icons only. */
  readonly label: string;
  /** 20 px icon (Lucide, stroke 1.5). */
  readonly icon: ReactNode;
}

export interface ModuleBarProps {
  /** Required: names the tablist for assistive technology. */
  'aria-label': string;
  items: readonly ModuleBarItem[];
  activeId: string | null;
  onActivate: (id: string) => void;
  /** Called with the full new order after a drag or a Ctrl+Arrow move; omit to disable reordering. */
  onReorder?: (ids: readonly string[]) => void;
  /** Accessible name of the pager shown when more modules exist than fit ("More modules"). */
  overflowLabel?: string;
  className?: string;
}

/**
 * Sizes from docs/05-design-system.md#spacing--sizing: 640 × 40 pill, 32 px slots at 8 px
 * gaps, 4 px inset. The overflow rule follows from them: the slots that fit are shown, the
 * rest live on further pages behind a trailing pager slot.
 */
export const moduleBarLayout = {
  width: 640,
  height: 40,
  slot: 32,
  gap: 8,
  padding: 4,
} as const;

/** How many 32 px slots fit in a bar of `width` px (16 at the default width). */
export const moduleBarCapacity = (width: number = moduleBarLayout.width): number => {
  const inner = width - 2 * moduleBarLayout.padding;
  const pitch = moduleBarLayout.slot + moduleBarLayout.gap;
  return Math.max(1, Math.floor((inner + moduleBarLayout.gap) / pitch));
};

export interface ModuleBarPage<T> {
  readonly visible: readonly T[];
  readonly pages: number;
  readonly page: number;
  /** Index of `visible[0]` in the full list. */
  readonly start: number;
}

/** Items shown on `page` when `items` overflow `capacity` slots (one slot goes to the pager). */
export const moduleBarPage = <T,>(
  items: readonly T[],
  page: number,
  capacity: number = moduleBarCapacity(),
): ModuleBarPage<T> => {
  if (items.length <= capacity) {
    return { visible: items, pages: 1, page: 0, start: 0 };
  }
  const perPage = Math.max(1, capacity - 1);
  const pages = Math.ceil(items.length / perPage);
  const current = Math.min(Math.max(0, page), pages - 1);
  const start = current * perPage;
  return { visible: items.slice(start, start + perPage), pages, page: current, start };
};

/** Pointer travel before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  readonly id: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly fromIndex: number;
  readonly toIndex: number;
  /** Distance between neighbouring slot centres, measured when the drag starts. */
  readonly pitch: number;
  /** −1 in right-to-left layouts, where the index grows towards the left. */
  readonly sign: 1 | -1;
  readonly active: boolean;
}

const isRtl = (node: Element): boolean =>
  getComputedStyle(node).direction === 'rtl' || node.closest('[dir="rtl"]') !== null;

const moveItem = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) {
    next.splice(to, 0, item);
  }
  return next;
};

/** Slots a neighbour moves while `from` is dragged over `to`. */
const shiftSlots = (index: number, from: number, to: number): number => {
  if (from < to && index > from && index <= to) {
    return -1;
  }
  if (from > to && index >= to && index < from) {
    return 1;
  }
  return 0;
};

/**
 * Border-box width of the bar as laid out, or `null` until measured. The bar's CSS caps it at
 * its container, so on a narrow work area the measured width is what the slots must fit in.
 * The observer is disconnected on unmount; nothing polls.
 */
const useMeasuredWidth = (ref: { readonly current: HTMLElement | null }): number | null => {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    const read = (next: number) => {
      setWidth(next > 0 ? next : null);
    };
    read(node.offsetWidth);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize[0];
      read(box !== undefined ? box.inlineSize : node.offsetWidth);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
};

/**
 * Module bar (docs/05-design-system.md "Module bar", docs/06-motion-spec.md "Module switch"):
 * the 640 × 40 pill under the panel — narrower when the panel is, with the slot count following
 * the measured width. A `tablist` of icon tabs; the active tab carries a `--surface-3` pill
 * that glides with the `switch` spring (shared `layoutId`). Arrow keys move and activate,
 * Home/End jump, Ctrl+Arrow reorders; dragging a tab past 4 px reorders with the pointer
 * (neighbours make room with the `layout` spring), Escape cancels. Icons scale to 1.08 on
 * hover with `toggle`.
 */
export function ModuleBar({
  items,
  activeId,
  onActivate,
  onReorder,
  overflowLabel,
  className,
  ...labelling
}: ModuleBarProps) {
  const groupId = useId();
  const barRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorTransition = useMotionPreset('switch');
  const layoutTransition = useMotionPreset('layout');
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  // Per-tab x offsets for drag reordering; a stable map, not a ref, because render reads it.
  const [xValues] = useState(() => new Map<string, MotionValue<number>>());

  const xOf = (id: string): MotionValue<number> => {
    let value = xValues.get(id);
    if (value === undefined) {
      value = motionValue(0);
      xValues.set(id, value);
    }
    return value;
  };

  // Capacity follows the laid-out width; before the first measurement (and in jsdom, where
  // boxes are 0 wide) the design-system default applies.
  const measuredWidth = useMeasuredWidth(barRef);
  const capacity = moduleBarCapacity(measuredWidth ?? moduleBarLayout.width);
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const perPage = items.length > capacity ? capacity - 1 : Math.max(1, items.length);
  const [page, setPage] = useState(() =>
    activeIndex >= 0 ? Math.floor(activeIndex / perPage) : 0,
  );
  // The active module's page wins whenever the active module changes.
  const [seenActive, setSeenActive] = useState(activeId);
  if (seenActive !== activeId) {
    setSeenActive(activeId);
    if (activeIndex >= 0) {
      setPage(Math.floor(activeIndex / perPage));
    }
  }
  const paged = moduleBarPage(items, page, capacity);
  const { visible } = paged;
  const overflowing = paged.pages > 1;
  // The page the active tab lives on; a page without it still needs one tab in the tab order.
  const activeOnPage = visible.some((item) => item.id === activeId);

  const updateDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  // A drag cannot survive a re-layout (the page or the slot pitch changed under the pointer):
  // drop it and let every tab settle home rather than commit a stale index.
  useEffect(() => {
    const current = dragRef.current;
    if (current !== null && !visible.some((item) => item.id === current.id)) {
      for (const value of xValues.values()) {
        value.set(0);
      }
      dragRef.current = null;
      setDrag(null);
    }
  }, [visible, xValues]);

  const tabs = useCallback(
    (): HTMLButtonElement[] =>
      listRef.current === null
        ? []
        : Array.from(listRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]')),
    [],
  );

  const focusAndActivate = (index: number) => {
    const count = visible.length;
    if (count === 0) {
      return;
    }
    const wrapped = ((index % count) + count) % count;
    const item = visible[wrapped];
    if (item !== undefined) {
      tabs()[wrapped]?.focus();
      onActivate(item.id);
    }
  };

  const reorderVisible = (from: number, to: number): boolean => {
    if (onReorder === undefined || from === to || to < 0 || to >= visible.length) {
      return false;
    }
    onReorder(moveItem(items, paged.start + from, paged.start + to).map((item) => item.id));
    return true;
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      if (dragRef.current?.active === true) {
        event.preventDefault();
        event.stopPropagation();
        finishDrag(false);
      }
      return;
    }
    const rtl = isRtl(event.currentTarget);
    const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const backward = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (forward || backward) {
      event.preventDefault();
      const delta = forward ? 1 : -1;
      if (event.ctrlKey) {
        if (reorderVisible(index, index + delta)) {
          // Moving the node in the DOM drops focus; take it back once React has reordered.
          queueMicrotask(() => {
            tabs()[index + delta]?.focus();
          });
        }
      } else {
        focusAndActivate(index + delta);
      }
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAndActivate(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAndActivate(visible.length - 1);
    }
  };

  // --- pointer drag ------------------------------------------------------------------------

  const settle = (value: MotionValue<number>, to: number, transition: Transition | null) => {
    value.stop();
    if (transition === null) {
      value.set(to);
    } else {
      animate(value, to, transition);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (onReorder === undefined || event.button !== 0 || visible.length < 2) {
      return;
    }
    const item = visible[index];
    if (item === undefined) {
      return;
    }
    const list = tabs();
    const first = list[0]?.getBoundingClientRect();
    const second = list[1]?.getBoundingClientRect();
    const measured =
      first !== undefined && second !== undefined ? Math.abs(second.left - first.left) : 0;
    suppressClick.current = false;
    updateDrag({
      id: item.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      fromIndex: index,
      toIndex: index,
      pitch: measured > 0 ? measured : moduleBarLayout.slot + moduleBarLayout.gap,
      sign: isRtl(event.currentTarget) ? -1 : 1,
      active: false,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (current?.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - current.startX;
    if (!current.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) {
        return;
      }
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      suppressClick.current = true;
    }
    const slots = Math.round((dx * current.sign) / current.pitch);
    const toIndex = Math.min(Math.max(0, current.fromIndex + slots), visible.length - 1);
    xOf(current.id).set(dx);
    if (!current.active || toIndex !== current.toIndex) {
      visible.forEach((item, index) => {
        if (item.id !== current.id) {
          const shift =
            shiftSlots(index, current.fromIndex, toIndex) * current.pitch * current.sign;
          settle(xOf(item.id), shift, layoutTransition);
        }
      });
      updateDrag({ ...current, active: true, toIndex });
    }
  };

  const finishDrag = (commit: boolean) => {
    const current = dragRef.current;
    if (current === null) {
      return;
    }
    const dragged = xOf(current.id);
    if (commit && current.active && current.toIndex !== current.fromIndex) {
      // The DOM reorders in this same batch: neighbours are already where they will land, the
      // dragged tab re-bases onto its new slot and springs the last few pixels home.
      for (const item of visible) {
        if (item.id !== current.id) {
          settle(xOf(item.id), 0, null);
        }
      }
      const displacement = (current.toIndex - current.fromIndex) * current.pitch * current.sign;
      dragged.set(dragged.get() - displacement);
      settle(dragged, 0, layoutTransition);
      reorderVisible(current.fromIndex, current.toIndex);
    } else {
      for (const item of visible) {
        settle(xOf(item.id), 0, layoutTransition);
      }
    }
    updateDrag(null);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
    const current = dragRef.current;
    if (current?.pointerId !== event.pointerId) {
      return;
    }
    const node = event.currentTarget;
    if (typeof node.hasPointerCapture === 'function' && node.hasPointerCapture(event.pointerId)) {
      node.releasePointerCapture(event.pointerId);
    }
    finishDrag(commit);
  };

  return (
    <LayoutGroup id={groupId}>
      <div
        ref={barRef}
        className={cx('muna-module-bar', className)}
        data-dragging={drag?.active === true ? '' : undefined}
      >
        <div
          ref={listRef}
          role="tablist"
          aria-label={labelling['aria-label']}
          aria-orientation="horizontal"
          className="muna-module-bar__list"
        >
          {visible.map((item, index) => {
            const isActive = item.id === activeId;
            const isDragged = drag?.active === true && drag.id === item.id;
            return (
              <motion.button
                key={item.id}
                type="button"
                role="tab"
                aria-label={item.label}
                aria-selected={isActive}
                // Roving tabindex: the active tab, or the first tab of a page that does not
                // hold it, so every page is reachable from the keyboard (not only the pager).
                tabIndex={isActive || (!activeOnPage && index === 0) ? 0 : -1}
                className="muna-module-bar__tab"
                data-active={isActive ? '' : undefined}
                data-dragged={isDragged ? '' : undefined}
                style={{ x: xOf(item.id) }}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onActivate(item.id);
                }}
                onKeyDown={(event) => {
                  onTabKeyDown(event, index);
                }}
                onPointerDown={(event) => {
                  onPointerDown(event, index);
                }}
                onPointerMove={onPointerMove}
                onPointerUp={(event) => {
                  onPointerEnd(event, true);
                }}
                onPointerCancel={(event) => {
                  onPointerEnd(event, false);
                }}
              >
                {isActive && (
                  <motion.span
                    aria-hidden="true"
                    layoutId="indicator"
                    className="muna-module-bar__indicator"
                    transition={indicatorTransition}
                  />
                )}
                <span aria-hidden="true" className="muna-module-bar__icon">
                  {item.icon}
                </span>
              </motion.button>
            );
          })}
        </div>
        {overflowing && (
          <button
            type="button"
            className="muna-module-bar__pager"
            aria-label={overflowLabel ?? 'More'}
            onClick={() => {
              setPage((paged.page + 1) % paged.pages);
            }}
          >
            <span aria-hidden="true" className="muna-module-bar__dots">
              {Array.from({ length: paged.pages }, (_, i) => (
                <span
                  key={i}
                  className="muna-module-bar__dot"
                  data-current={i === paged.page ? '' : undefined}
                />
              ))}
            </span>
          </button>
        )}
      </div>
    </LayoutGroup>
  );
}
