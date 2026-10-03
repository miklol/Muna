import {
  type DashboardSlot,
  defaultSettings,
  readDashboardSettings,
  writeDashboardSettings,
} from '@muna/contracts';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { LayoutGroup, motion, type PanInfo } from 'motion/react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { persistSettings, useSettings } from '../../lib/settings';
import { useAppStore } from '../../store/app-store';
import { findModule, type ModuleDefinition, modules } from '../registry';
import './dashboard.css';
import {
  addSlot,
  canSetSpan,
  dropIndex,
  freeCells,
  mergeHidden,
  moveSlot,
  type Rect,
  removeSlot,
  setSpan,
  visibleSlots,
} from './layout';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The dashboard never shows itself as a widget. */
const OWN_ID = 'dashboard';

/** A module the grid can show: enabled, with a widget, and not the dashboard itself. */
const hasWidget = (moduleId: string): boolean =>
  moduleId !== OWN_ID && findModule(moduleId)?.widget !== undefined;

interface SlotCardProps {
  readonly slot: DashboardSlot;
  readonly module: ModuleDefinition;
  readonly index: number;
  readonly count: number;
  readonly editing: boolean;
  readonly canWiden: boolean;
  readonly onMove: (from: number, to: number) => void;
  readonly onSpan: (index: number, span: 1 | 2) => void;
  readonly onRemove: (moduleId: string) => void;
  readonly onOpen: (moduleId: string) => void;
  readonly onDragEnd: (from: number, point: { x: number; y: number }) => void;
  readonly register: (moduleId: string, element: HTMLElement | null) => void;
}

/**
 * One grid cell: the module's card with its glyph and title, the widget as the body, and on the
 * right an arrow to open the module. In edit mode the body gives way to the controls — move
 * left and right, wider or narrower, remove — and the whole card can be dragged onto another
 * card's place; the `layout` spring carries every card to where it now belongs.
 */
function SlotCard({
  slot,
  module,
  index,
  count,
  editing,
  canWiden,
  onMove,
  onSpan,
  onRemove,
  onOpen,
  onDragEnd,
  register,
}: SlotCardProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const layoutSpring = useMotionPreset('layout');
  const dragSpring = useMotionPreset('drag');
  const name = t(module.titleKey);
  const Icon = module.icon;
  const Widget = module.widget;
  return (
    <motion.li
      ref={(element) => {
        register(slot.moduleId, element);
      }}
      layout={reduceMotion ? false : 'position'}
      transition={{ ...dragSpring, layout: layoutSpring }}
      drag={editing && !reduceMotion}
      dragSnapToOrigin
      dragMomentum={false}
      dragElastic={0.15}
      whileDrag={{ scale: 1.03, zIndex: 1 }}
      onDragEnd={(_event, info: PanInfo) => {
        onDragEnd(index, info.point);
      }}
      className="dashboard__slot"
      data-span={slot.span}
      data-module={slot.moduleId}
      aria-label={t('dashboard.widget', { name })}
    >
      <Card
        className="dashboard__card"
        icon={<Icon size={20} strokeWidth={1.5} />}
        title={name}
        trailing={
          editing ? undefined : (
            <IconButton
              aria-label={t('dashboard.open', { name })}
              onPress={() => {
                onOpen(slot.moduleId);
              }}
            >
              <ArrowUpRight strokeWidth={ICON_STROKE} />
            </IconButton>
          )
        }
      >
        {editing ? (
          <div
            className="dashboard__controls"
            role="group"
            aria-label={t('dashboard.arrange', { name })}
          >
            <IconButton
              aria-label={t('dashboard.moveLeft', { name })}
              isDisabled={index === 0}
              onPress={() => {
                onMove(index, index - 1);
              }}
            >
              <ChevronLeft strokeWidth={ICON_STROKE} />
            </IconButton>
            <IconButton
              aria-label={t('dashboard.moveRight', { name })}
              isDisabled={index === count - 1}
              onPress={() => {
                onMove(index, index + 1);
              }}
            >
              <ChevronRight strokeWidth={ICON_STROKE} />
            </IconButton>
            {slot.span === 1 ? (
              <IconButton
                aria-label={t('dashboard.wider', { name })}
                isDisabled={!canWiden}
                onPress={() => {
                  onSpan(index, 2);
                }}
              >
                <Maximize2 strokeWidth={ICON_STROKE} />
              </IconButton>
            ) : (
              <IconButton
                aria-label={t('dashboard.narrower', { name })}
                onPress={() => {
                  onSpan(index, 1);
                }}
              >
                <Minimize2 strokeWidth={ICON_STROKE} />
              </IconButton>
            )}
            <IconButton
              aria-label={t('dashboard.remove', { name })}
              onPress={() => {
                onRemove(slot.moduleId);
              }}
            >
              <X strokeWidth={ICON_STROKE} />
            </IconButton>
          </div>
        ) : (
          Widget !== undefined && (
            <div className="dashboard__widget">
              <Widget span={slot.span} />
            </div>
          )
        )}
      </Card>
    </motion.li>
  );
}

interface AddCardProps {
  readonly candidates: readonly ModuleDefinition[];
  readonly onAdd: (moduleId: string) => void;
}

/** The empty place at the end of the grid in edit mode: one button per widget not yet shown. */
function AddCard({ candidates, onAdd }: AddCardProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const layoutSpring = useMotionPreset('layout');
  return (
    <motion.li
      layout={reduceMotion ? false : 'position'}
      transition={layoutSpring}
      className="dashboard__slot dashboard__slot--add"
      data-span={1}
    >
      <Card
        className="dashboard__card"
        icon={<Plus size={20} strokeWidth={1.5} />}
        title={t('dashboard.addTitle')}
      >
        <div className="dashboard__add" role="group" aria-label={t('dashboard.addTitle')}>
          {candidates.map((module) => {
            const name = t(module.titleKey);
            return (
              <Button
                key={module.id}
                variant="secondary"
                aria-label={t('dashboard.add', { name })}
                onPress={() => {
                  onAdd(module.id);
                }}
              >
                {name}
              </Button>
            );
          })}
        </div>
      </Card>
    </motion.li>
  );
}

/**
 * The dashboard panel (docs/modules/dashboard.md): a 2 × 4 grid of the other modules' widgets
 * in cards, each spanning one or two columns. The pencil enters edit mode, where cards can be
 * dragged onto one another's place or moved with the arrows, made wider or narrower, removed,
 * and added back from the empty place at the end. Every change is written to
 * `settings.modules.dashboard` at once (docs/modules/dashboard.md "Acceptance criteria":
 * changes persist). Disabled modules' widgets are left out and come back when re-enabled.
 */
export function DashboardPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const document = useSettings() ?? defaultSettings();
  const stored = readDashboardSettings(document).slots;
  const disabled = document.shell.disabledModules;
  const visible = visibleSlots(stored, hasWidget, disabled);
  const [editing, setEditing] = useState(false);
  const elements = useRef(new Map<string, HTMLElement>());

  const register = useCallback((moduleId: string, element: HTMLElement | null) => {
    if (element === null) {
      elements.current.delete(moduleId);
    } else {
      elements.current.set(moduleId, element);
    }
  }, []);

  const commit = (edited: readonly DashboardSlot[]) => {
    const slots = mergeHidden(edited, stored, visible);
    persistSettings(queryClient, writeDashboardSettings(document, { slots }));
  };
  const open = (moduleId: string) => {
    useAppStore.getState().setActiveModule(moduleId);
  };
  const onDragEnd = (from: number, point: { x: number; y: number }) => {
    const rects: (Rect | null)[] = visible.map((slot) => {
      const element = elements.current.get(slot.moduleId);
      return element === undefined ? null : element.getBoundingClientRect();
    });
    const to = dropIndex(rects, point, from);
    if (to !== from) commit(moveSlot(visible, from, to));
  };

  const candidates = modules.filter(
    (module) =>
      hasWidget(module.id) &&
      !disabled.includes(module.id) &&
      !visible.some((slot) => slot.moduleId === module.id),
  );
  const free = freeCells(visible);
  const showAdd = editing && free > 0 && candidates.length > 0;

  if (visible.length === 0 && !editing) {
    return (
      <div className="dashboard" data-empty>
        <EmptyState
          className="dashboard__empty"
          icon={<LayoutGrid size={24} strokeWidth={1.5} />}
          title={t('dashboard.empty.title')}
          description={t('dashboard.empty.body')}
          action={
            <Button
              variant="primary"
              onPress={() => {
                setEditing(true);
              }}
            >
              {t('dashboard.edit')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="dashboard" data-editing={editing || undefined}>
      <div className="dashboard__toolbar">
        <Text as="p" variant="footnote" tone="secondary" truncate={1} className="dashboard__hint">
          {editing ? t('dashboard.hint') : t('dashboard.summary', { count: visible.length })}
        </Text>
        <IconButton
          aria-label={editing ? t('dashboard.done') : t('dashboard.edit')}
          aria-pressed={editing}
          isActive={editing}
          onPress={() => {
            setEditing((on) => !on);
          }}
        >
          {editing ? <Check strokeWidth={ICON_STROKE} /> : <Pencil strokeWidth={ICON_STROKE} />}
        </IconButton>
      </div>
      <LayoutGroup id="dashboard-grid">
        <ul className="dashboard__grid" aria-label={t('dashboard.grid')}>
          {visible.map((slot, index) => {
            const module = findModule(slot.moduleId);
            if (module === undefined) return null;
            return (
              <SlotCard
                key={slot.moduleId}
                slot={slot}
                module={module}
                index={index}
                count={visible.length}
                editing={editing}
                canWiden={canSetSpan(visible, index, 2)}
                onMove={(from, to) => {
                  commit(moveSlot(visible, from, to));
                }}
                onSpan={(at, span) => {
                  commit(setSpan(visible, at, span));
                }}
                onRemove={(moduleId) => {
                  commit(removeSlot(visible, moduleId));
                }}
                onOpen={open}
                onDragEnd={onDragEnd}
                register={register}
              />
            );
          })}
          {showAdd && (
            <AddCard
              candidates={candidates}
              onAdd={(moduleId) => {
                commit(addSlot(visible, moduleId));
              }}
            />
          )}
        </ul>
      </LayoutGroup>
    </div>
  );
}
