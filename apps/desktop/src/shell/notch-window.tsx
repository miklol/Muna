import type { MorphReport, ShapeRect, ShellLayout } from '@muna/contracts';
import {
  commands,
  defaultHudSettings,
  HUD_VOLUME_STEP,
  readHudSettings,
  type ScrollOnStrip,
  SHELL_ACTION_IDS,
  STRIP_HEIGHT_PX,
} from '@muna/contracts';
import {
  contentExitTransition,
  contentRecipe,
  moduleBarRecipe,
  reducedMotionTransition,
  snapZoneRecipe,
  springs,
  timings,
  useReduceMotion,
} from '@muna/ui/motion';
import {
  ModuleBar,
  type ModuleBarItem,
  NotchSurface,
  notchMorphRadiusVar,
} from '@muna/ui/primitives';
import { AnimatePresence, motion, type MotionStyle, type Transition } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import { type DragOutHandlers, useDragOut, useDragSpike } from '../lib/drag-out';
import { useIsPanelHeld } from '../lib/panel-hold';
import { persistSettings, useSettings } from '../lib/settings';
import { currentWindowLabel } from '../lib/window-label';
import {
  dropModuleOf,
  type ModuleDefinition,
  modules as registeredModules,
  snapModuleOf,
} from '../modules/registry';
import { useAppStore } from '../store/app-store';
import { listActions, runAction, type ShellActionContext } from './actions';
import { HitTestOverlay, hitTestOverlayEnabled } from './hit-test-overlay';
import {
  anchoredBox,
  type Box,
  contains,
  padded,
  SpeedTracker,
  toShapeRect,
  union,
} from './hit-zones';
import { type ShellEffect, ShellMachine, type ShellSnapshot, type ShellState } from './machine';
import { orderModules, resolveActive, stepModule } from './module-order';
import { MorphSampler } from './morph-sampler';
import { morphTransition } from './morph-transition';
import { CommandPalette } from './palette';
import { Panel, PanelEmptyState } from './panel';
import {
  type GeometryInput,
  moduleBarOffsetY,
  moduleBarSize,
  showsDrop,
  showsLarge,
  showsPanel,
  showsSnap,
  type Size,
  targetOffsetY,
  targetSize,
} from './shell-geometry';
import { Strip } from './strip';
import {
  type DecisionPresentation,
  type HudPresentation,
  hudNoticeShowing,
  wantsWide,
} from './strip-content';
import {
  cancelDrop,
  cancelSnap,
  publishShapeRects,
  reportMorph,
  setNotchFocusable,
  setStripSuspended,
  useDropSubscription,
  useHotkeySubscription,
  useShellLayoutSubscription,
  useShellPointerDownOutsideSubscription,
  useShellReady,
  useSnapSubscription,
} from './use-shell';
import { useStripContentSubscription } from './use-strip-content';

export interface NotchWindowProps {
  /** Panel body override; tests inject a text field. Defaults to the active module's panel. */
  panelBody?: ReactNode;
  /** The modules the bar offers; defaults to the registry (tests inject fakes). */
  modules?: readonly ModuleDefinition[];
}

/** Module-bar glyph size (docs/05-design-system.md "Module bar": icons 20). */
const MODULE_ICON_SIZE = 20;
const MODULE_ICON_STROKE = 1.75;
const noModules: readonly string[] = [];
/** Where a drag is before its first `DropMoved`: no tile is there. */
const originPoint = { x: -1, y: -1 } as const;

type Layout = Pick<ShellLayout, 'shape' | 'stripHeight' | 'stripTopOffset' | 'panelMaxWidth'>;

/** Layout used before the shell has attached the window (and outside Tauri). */
const fallbackLayout: Layout = {
  shape: 'notch',
  stripHeight: STRIP_HEIGHT_PX.default,
  stripTopOffset: 0,
  panelMaxWidth: 1000,
};

const TEXT_FIELD_SELECTOR = [
  'input:not([type="button"],[type="checkbox"],[type="radio"],[type="range"],[type="submit"],[type="reset"],[type="file"])',
  'textarea',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(', ');

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof Element && target.matches(TEXT_FIELD_SELECTOR);

/** The HUD's level track: a press or hover there drags the level instead of working the shell. */
const LEVEL_TRACK_SELECTOR = '.muna-level-track';

/**
 * Controls that live inside the strip and own the pointer: the HUD's level track and the
 * decision pair. A press there answers the control, not the panel, and hovering them is not
 * reveal intent.
 */
const STRIP_CONTROL_SELECTOR = `${LEVEL_TRACK_SELECTOR}, .muna-decision`;

const isStripControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(STRIP_CONTROL_SELECTOR) !== null;

/** Whether a wheel notch over the strip should move the volume (docs/modules/hud.md). */
export const wheelNudgesVolume = (
  scrollOnStrip: ScrollOnStrip,
  showing: ReturnType<typeof hudNoticeShowing>,
): boolean => scrollOnStrip === 'volume' || showing === 'volume';

/** Percent to move per wheel event: one step per notch, up when the wheel rolls up. */
export const wheelVolumeDelta = (deltaY: number): number => -Math.sign(deltaY) * HUD_VOLUME_STEP;

const ignoreRefusal = () => {
  // The platform refused or the device vanished; the strip shows whatever is true next.
};

/** S2 spike: a suppressed native drag lands in the app log for the driver (G5). */
const dragSpikeHandlers: DragOutHandlers = {
  onNativeDragStart: () => {
    commands.uiWarn('drag out html5 dragstart').catch(ignoreRefusal);
  },
};

/** Radii the morph animates between, read from the tokens so theme changes are honoured. */
const readRadiusPx = (element: Element, token: string, fallback: number): number => {
  const parsed = Number.parseFloat(getComputedStyle(element).getPropertyValue(token));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boxOf = (node: Element): Box => {
  const rect = node.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
};

const sameRect = (a: ShapeRect, b: ShapeRect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const sameRects = (a: readonly ShapeRect[], b: readonly ShapeRect[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((rect, i) => {
    const other = b[i];
    if (other === undefined) {
      return false;
    }
    return sameRect(rect, other);
  });
};

const useShellMachine = (): readonly [ShellSnapshot, ShellMachine] => {
  const [machine] = useState(() => new ShellMachine());
  useEffect(
    () => () => {
      machine.dispose();
    },
    [machine],
  );
  const subscribe = useCallback((onChange: () => void) => machine.subscribe(onChange), [machine]);
  const snapshot = useSyncExternalStore(subscribe, () => machine.snapshot);
  return [snapshot, machine];
};

/** What the shell animates, as a key: a morph is in flight until Motion settles on it. */
const geometryKey = (width: number, height: number, offsetY: number, radius: number): string =>
  `${String(width)}x${String(height)}@${String(offsetY)}r${String(radius)}`;

/**
 * The notch: one `NotchSurface` whose real width/height morph between the strip, the hover
 * reveal and the panel under the state machine in `machine.ts` (docs/modules/notch-shell.md).
 * Rust places the window and decides yield; this component reports ready, publishes the rects
 * the pointer may hit, and drives the morph, pin and focus rules.
 */
export function NotchWindow({ panelBody, modules = registeredModules }: NotchWindowProps) {
  const { t } = useTranslation();
  const content = useAppStore((state) => state.stripContent);
  const contentAt = useAppStore((state) => state.stripContentAt);
  const layoutFromShell = useAppStore((state) => state.shellLayout);
  const yieldState = useAppStore((state) => state.yieldState);
  const activeModuleId = useAppStore((state) => state.activeModuleId);
  const setActiveModule = useAppStore((state) => state.setActiveModule);
  const settings = useSettings();
  const queryClient = useQueryClient();
  useStripContentSubscription();
  useShellLayoutSubscription();
  useDropSubscription();
  useSnapSubscription();
  const reduceMotion = useReduceMotion();

  const layout: Layout = layoutFromShell ?? fallbackLayout;
  const [snapshot, machine] = useShellMachine();
  const { state } = snapshot;

  // --- modules -------------------------------------------------------------------------------

  // Order and disabled set live in the settings document (Settings → Modules); until it has
  // loaded the bar shows the registry order.
  const moduleOrder = settings?.shell.moduleOrder ?? noModules;
  const disabledModules = settings?.shell.disabledModules ?? noModules;
  const orderedModules = useMemo(
    () => orderModules(modules, moduleOrder, disabledModules),
    [disabledModules, moduleOrder, modules],
  );
  // The drop row comes from a module without a panel, so it is looked up in the full list less
  // the disabled ones — disabling the module turns drops off (docs/modules/drop-actions.md).
  const dropModule = useMemo(
    () => dropModuleOf(modules.filter((module) => !disabledModules.includes(module.id))),
    [disabledModules, modules],
  );
  const DropSurface = dropModule?.drop;
  // The snap zones likewise (docs/modules/window-snap.md); Rust reads the same disabled list,
  // so a disabled module starts no drag session either.
  const enabledModules = useMemo(
    () => modules.filter((module) => !disabledModules.includes(module.id)),
    [disabledModules, modules],
  );
  const SnapSurface = snapModuleOf(enabledModules)?.snap;
  const setModuleOrder = useCallback(
    (ids: readonly string[]) => {
      if (settings !== undefined) {
        persistSettings(queryClient, {
          ...settings,
          shell: { ...settings.shell, moduleOrder: [...ids] },
        });
      }
    },
    [queryClient, settings],
  );
  const activeModule = resolveActive(orderedModules, activeModuleId);
  const hasModuleBar = orderedModules.length > 0;

  // --- hud -----------------------------------------------------------------------------------

  const hudSettings = useMemo(
    () => (settings === undefined ? defaultHudSettings() : readHudSettings(settings)),
    [settings],
  );
  const hudShowing = hudNoticeShowing(content);
  // Volume follows the drag live; brightness is written once on release (DDC/CI is ~50 ms a
  // call) and only when one monitor exists, since the notice names none (docs/modules/hud.md).
  const hud = useMemo<HudPresentation>(() => {
    const showLevelText = hudSettings.showLevelText;
    switch (hudShowing) {
      case 'volume':
        return {
          showLevelText,
          onLevelChange: (percent) => {
            void commands.hudSetVolume(percent).catch(ignoreRefusal);
          },
        };
      case 'brightness':
        return {
          showLevelText,
          onLevelChangeEnd: (percent) => {
            void commands
              .getHudSnapshot()
              .then((snapshot) => {
                const [only, second] = snapshot.monitors;
                if (only !== undefined && second === undefined) {
                  return commands.hudSetBrightness(only.id, percent);
                }
                return undefined;
              })
              .catch(ignoreRefusal);
          },
        };
      case 'mic':
      case null:
        return { showLevelText };
    }
  }, [hudSettings.showLevelText, hudShowing]);

  // --- decision ------------------------------------------------------------------------------

  // Allow / Deny on the strip answer a coding agent's held permission request
  // (docs/modules/ai-coding.md). The pills dim while the answer travels; Rust retracts the
  // activity once the agent has it, so nothing here needs to clear.
  const [pendingDecision, setPendingDecision] = useState<string | null>(null);
  const decision = useMemo<DecisionPresentation>(
    () => ({
      pending: pendingDecision,
      onDecide: (session, allow) => {
        setPendingDecision(session);
        void commands
          .aiCodingCommand({ kind: allow ? 'allow' : 'deny', session })
          .catch(ignoreRefusal)
          .finally(() => {
            setPendingDecision((current) => (current === session ? null : current));
          });
      },
    }),
    [pendingDecision],
  );
  const moduleBarItems = useMemo<readonly ModuleBarItem[]>(
    () =>
      orderedModules.map((module) => {
        const Icon = module.icon;
        return {
          id: module.id,
          label: t(module.titleKey),
          icon: <Icon size={MODULE_ICON_SIZE} strokeWidth={MODULE_ICON_STROKE} />,
        };
      }),
    [orderedModules, t],
  );

  const rootRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef<HTMLDivElement>(null);
  const speed = useRef(new SpeedTracker());
  const sampler = useRef(new MorphSampler());
  const lastPublished = useRef<ShapeRect[]>([]);

  // S2 spike (docs/spikes/m4-drag.md): `MUNA_SPIKE=drag` arms a drag-out of a file from the
  // whole window; `useDragSpike` answers `null` in the product and nothing is attached.
  const dragSpike = useDragSpike();
  useDragOut(rootRef, dragSpike, dragSpikeHandlers);

  const [panelContentHeight, setPanelContentHeight] = useState<number | null>(null);
  const [dropContentSize, setDropContentSize] = useState<Size | null>(null);
  const [snapContentSize, setSnapContentSize] = useState<Size | null>(null);
  const [lastMorph, setLastMorph] = useState<MorphReport | null>(null);
  const [publishedRects, setPublishedRects] = useState<readonly ShapeRect[]>([]);
  const [radii, setRadii] = useState({ strip: 14, panel: 28 });

  useEffect(() => {
    if (rootRef.current !== null) {
      setRadii({
        strip: readRadiusPx(rootRef.current, '--radius-strip', 14),
        panel: readRadiusPx(rootRef.current, '--radius-panel', 28),
      });
    }
  }, []);

  // --- yield, hotkeys and click-through clicks come from Rust -----------------------------

  useEffect(() => {
    machine.send({ type: 'yield', state: yieldState });
  }, [machine, yieldState]);

  // The command palette replaces the module body while open; it closes with the panel.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteBindings, setPaletteBindings] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const openPalette = useCallback(() => {
    setPaletteOpen(true);
    commands
      .getHotkeys()
      .then((bindings) => {
        setPaletteBindings(
          new Map(
            bindings.flatMap((binding) =>
              binding.chord === null ? [] : [[binding.action, binding.chord] as const],
            ),
          ),
        );
      })
      .catch(() => {
        // Not running inside Tauri: the rows show without caps.
      });
  }, []);
  const paletteActions = useMemo(
    () => listActions(modules).filter((action) => action.runnable),
    [modules],
  );

  // Hotkeys and palette rows resolve to shell actions or module actions (`shell/actions.ts`);
  // the latest module order and active module are read through a ref so the subscription
  // stays put while they change.
  const shellActionContext = useRef<ShellActionContext>({
    send: (event) => machine.send(event),
    orderedModules,
    activeModuleId,
    setActiveModule,
    openPalette,
  });
  const paletteOpenRef = useRef(paletteOpen);
  useLayoutEffect(() => {
    paletteOpenRef.current = paletteOpen;
    shellActionContext.current = {
      send: (event) => machine.send(event),
      orderedModules,
      activeModuleId,
      setActiveModule,
      openPalette,
    };
  });
  const dispatchAction = useCallback(
    (action: string) => {
      // The palette's own chord toggles it; any other action leaves the palette behind.
      if (action === SHELL_ACTION_IDS.palette && paletteOpenRef.current) {
        setPaletteOpen(false);
        return;
      }
      setPaletteOpen(false);
      runAction(action, { shell: shellActionContext.current, modules });
    },
    [modules],
  );
  useHotkeySubscription(dispatchAction);
  const runFromPalette = dispatchAction;
  const activateModule = useCallback(
    (id: string) => {
      setPaletteOpen(false);
      setActiveModule(id);
    },
    [setActiveModule],
  );
  useShellPointerDownOutsideSubscription(
    useCallback(() => {
      machine.send({ type: 'pressOutside' });
    }, [machine]),
  );

  // Effects the reducer cannot perform itself.
  useEffect(
    () =>
      machine.subscribe((_snapshot, effects: readonly ShellEffect[]) => {
        for (const effect of effects) {
          if (effect.type === 'setFocusable') {
            setNotchFocusable(effect.focusable);
          } else if (effect.type === 'blurField') {
            const active = document.activeElement;
            if (active instanceof HTMLElement && rootRef.current?.contains(active)) {
              active.blur();
            }
          }
        }
      }),
    [machine],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        machine.send({ type: 'escape' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [machine]);

  // --- drops ---------------------------------------------------------------------------------

  // A drag carrying files (docs/modules/drop-actions.md): Rust opens a session and the shell
  // shows the row; the row runs or cancels the drop and ends the session, and the machine
  // follows the session out. The machine's live state is read after `dropEnter` because the
  // rendered one is a commit behind: a refused entry (parked, or no module offers a row) means
  // nothing will ever handle the items, so Rust forgets them at once.
  const dropSession = useAppStore((store) => store.dropSession);
  const dropPosition = useAppStore((store) => store.dropPosition);
  const endDrop = useAppStore((store) => store.endDrop);
  const dropSessionId = dropSession?.session ?? null;
  const forgottenDrop = useRef<number | null>(null);
  /** Rust forgets the items (once per session) and the store the session. */
  const forgetDrop = useCallback(
    (session: number) => {
      if (forgottenDrop.current !== session) {
        forgottenDrop.current = session;
        cancelDrop(session);
      }
      endDrop(session);
    },
    [endDrop],
  );
  useEffect(() => {
    if (dropSessionId === null) {
      return;
    }
    if (DropSurface !== undefined) {
      machine.send({ type: 'dropEnter' });
    }
    if (machine.snapshot.state !== 'drop') {
      forgetDrop(dropSessionId);
    }
  }, [DropSurface, dropSessionId, forgetDrop, machine]);
  const dropShown = showsDrop(state);
  useEffect(() => {
    // The row closed under an open session (Esc, park): the items have nowhere to land.
    if (dropShown || dropSessionId === null || machine.snapshot.state === 'drop') {
      return;
    }
    forgetDrop(dropSessionId);
  }, [dropSessionId, dropShown, forgetDrop, machine]);
  useEffect(() => {
    // The session ended (the drag left, or the row handled it) while the row still shows.
    if (dropShown && dropSessionId === null) {
      machine.send({ type: 'dropLeave' });
    }
  }, [dropSessionId, dropShown, machine]);
  const onDropDone = useCallback(() => {
    if (dropSessionId !== null) {
      endDrop(dropSessionId);
    }
  }, [dropSessionId, endDrop]);

  // A module holding the panel (a guided flow) pins it until the hold goes.
  const held = useIsPanelHeld();
  useEffect(() => {
    machine.send({ type: 'hold', held });
  }, [held, machine]);

  // Ctrl+Tab / Ctrl+Shift+Tab step through the modules while the panel is open
  // (docs/modules/notch-shell.md, "Rules").
  const panelShown = showsPanel(state);
  const largeShown = showsLarge(state);
  if (paletteOpen && !panelShown) {
    // The palette lives inside the panel; adjusting during render avoids a cascading effect.
    setPaletteOpen(false);
  }
  useEffect(() => {
    if (!panelShown || orderedModules.length < 2) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      const next = stepModule(orderedModules, activeModuleId, event.shiftKey ? -1 : 1);
      if (next !== null) {
        event.preventDefault();
        setActiveModule(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeModuleId, orderedModules, panelShown, setActiveModule]);

  // --- geometry ------------------------------------------------------------------------------

  const wide = !largeShown && wantsWide(content);
  const geometry = useMemo<GeometryInput>(
    () => ({ layout, wide, panelContentHeight, dropContentSize, snapContentSize }),
    [dropContentSize, layout, panelContentHeight, snapContentSize, wide],
  );
  const target = targetSize(state, geometry);
  const offsetY = targetOffsetY(state, geometry);
  const parked = state === 'parked';

  // The panel content is the measurement node: it lays out at its natural height inside the
  // clipping surface and the shell animates its height to match (motion spec, "Strip → panel").
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (node === null || !panelShown) {
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      setPanelContentHeight(node.offsetHeight);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize[0];
      setPanelContentHeight(box !== undefined ? box.blockSize : node.offsetHeight);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [panelShown]);

  // The drop row is measured the same way, in both axes: it lays out at its natural width
  // (never wider than the panel) and the shell morphs to hold it. The measurement is cleared
  // when the row goes, so the next drag starts its morph from the strip again.
  useLayoutEffect(() => {
    const node = dropRef.current;
    if (node === null || !dropShown) {
      setDropContentSize(null);
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      setDropContentSize({ width: node.offsetWidth, height: node.offsetHeight });
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize[0];
      setDropContentSize(
        box !== undefined
          ? { width: box.inlineSize, height: box.blockSize }
          : { width: node.offsetWidth, height: node.offsetHeight },
      );
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [dropShown, dropSessionId]);

  const restBox = useCallback(
    (forState: ShellState, input: GeometryInput): Box => {
      const root = rootRef.current;
      const centreX = root === null ? 0 : root.clientWidth / 2;
      const size = targetSize(forState, input);
      return anchoredBox(
        centreX,
        layout.stripTopOffset + targetOffsetY(forState, input),
        size.width,
        size.height,
      );
    },
    [layout.stripTopOffset],
  );

  /** Where the module bar rests under the panel in `forState`. */
  const moduleBarBox = useCallback(
    (forState: ShellState, input: GeometryInput): Box => {
      const root = rootRef.current;
      const centreX = root === null ? 0 : root.clientWidth / 2;
      return anchoredBox(
        centreX,
        layout.stripTopOffset + moduleBarOffsetY(forState, input),
        moduleBarSize.width,
        moduleBarSize.height,
      );
    },
    [layout.stripTopOffset],
  );

  // --- window snap ---------------------------------------------------------------------------

  // A window dragged near the notch (docs/modules/window-snap.md): Rust tracks the drag and
  // reports the cursor over this window; the shell decides "near" against the strip at rest —
  // or the zones while they show — plus the hot-zone padding, the machine waits out the intent
  // delay, and the zones apply or cancel once the drag ends over this window. A drag that ends
  // elsewhere, or before the zones showed, is forgotten here and in Rust.
  const windowLabel = useMemo(() => currentWindowLabel(), []);
  const snapSession = useAppStore((store) => store.snapSession);
  const snapPosition = useAppStore((store) => store.snapPosition);
  const endSnap = useAppStore((store) => store.endSnap);
  const snapSessionId = snapSession?.session ?? null;
  const snapEnded = snapSession?.ended ?? false;
  const snapEndedHere = snapEnded && snapSession?.endedOver === windowLabel;
  const snapShown = showsSnap(state);
  useEffect(() => {
    if (snapSessionId === null || snapEnded || SnapSurface === undefined) {
      return;
    }
    if (snapPosition === null) {
      machine.send({ type: 'snapFar' });
      return;
    }
    // Against the rest boxes, not the live (mid-morph) one: the strip's hot zone stays valid
    // while the zones grow out of it, and a narrow row never shrinks the zone under the cursor.
    const near =
      contains(padded(restBox('collapsed', geometry), timings.snapHotZonePx), snapPosition) ||
      (snapShown &&
        contains(padded(restBox('snap', geometry), timings.snapHotZonePx), snapPosition));
    machine.send({ type: near ? 'snapNear' : 'snapFar' });
  }, [SnapSurface, geometry, machine, restBox, snapEnded, snapPosition, snapSessionId, snapShown]);
  useEffect(() => {
    if (!snapSession?.ended) {
      return;
    }
    if (snapSession.endedOver === windowLabel && snapShown && SnapSurface !== undefined) {
      // The zones resolve the tile under the cursor and call `onSnapDone`.
      return;
    }
    if (snapSession.endedOver === windowLabel) {
      // Over this window, but the zones were not showing: nothing can place it.
      cancelSnap(snapSession.session);
    }
    endSnap(snapSession.session);
  }, [SnapSurface, endSnap, snapSession, snapShown, windowLabel]);
  useEffect(() => {
    // The session is gone (applied, cancelled or ended elsewhere) while the zones still show.
    if (snapShown && snapSessionId === null) {
      machine.send({ type: 'snapEnd' });
    }
  }, [machine, snapSessionId, snapShown]);
  const onSnapDone = useCallback(() => {
    if (snapSessionId !== null) {
      endSnap(snapSessionId);
    }
  }, [endSnap, snapSessionId]);

  // The zones are measured like the drop row.
  useLayoutEffect(() => {
    const node = snapRef.current;
    if (node === null || !snapShown) {
      setSnapContentSize(null);
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      setSnapContentSize({ width: node.offsetWidth, height: node.offsetHeight });
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize[0];
      setSnapContentSize(
        box !== undefined
          ? { width: box.inlineSize, height: box.blockSize }
          : { width: node.offsetWidth, height: node.offsetHeight },
      );
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [snapShown, snapSessionId]);

  const publish = useCallback((rects: ShapeRect[]) => {
    if (rects.length === 0 || sameRects(rects, lastPublished.current)) {
      return;
    }
    lastPublished.current = rects;
    setPublishedRects(rects);
    publishShapeRects(rects);
  }, []);

  /**
   * Publishes what the pointer may hit. The strip at rest — wide or not — comes first: the
   * yield rules measure caption overlap against it, so it follows neither Peek nor the morph,
   * and in the strip states it is the only rect (the shell polls faster while more than one is
   * published). A second rect covers the interactive area: the padded shape while revealed or
   * open — spanning the module bar too while the panel shows it — and current plus target
   * bounds while a morph is in flight.
   */
  const publishShapes = useCallback(
    (inFlight: boolean) => {
      if (parked) {
        return;
      }
      const rects: ShapeRect[] = [toShapeRect(restBox('collapsed', geometry))];
      const targetBox = restBox(state, geometry);
      const node = shellRef.current;
      const current = node === null ? null : boxOf(node);
      // A node that has not laid out yet (zero size) has nothing to span.
      let span =
        inFlight && current !== null && current.width > 0 ? union(current, targetBox) : targetBox;
      if (state === 'collapsed' || state === 'peek') {
        if (inFlight) {
          rects.push(toShapeRect(span));
        }
      } else {
        if (hasModuleBar && showsPanel(state)) {
          span = union(span, moduleBarBox(state, geometry));
        }
        rects.push(toShapeRect(padded(span)));
      }
      publish(rects);
    },
    [geometry, hasModuleBar, moduleBarBox, parked, publish, restBox, state],
  );

  const publishAtRest = useCallback(() => {
    publishShapes(false);
  }, [publishShapes]);
  useShellReady(publishAtRest);

  // --- morph -------------------------------------------------------------------------------

  // The morph is in flight from the moment the target changes until Motion settles on it; the
  // material follows: the panel's while a panel or the drop row shows or is still collapsing,
  // black otherwise (they are alike at strip size, where the switch happens).
  const radius = largeShown ? radii.panel : radii.strip;
  const currentGeometry = geometryKey(target.width, target.height, offsetY, radius);
  const [settledGeometry, setSettledGeometry] = useState(currentGeometry);
  const [wasParked, setWasParked] = useState(parked);
  if (parked !== wasParked) {
    // Parking unmounts the shell node and un-parking mounts it at its target: nothing animates,
    // so nothing would settle.
    setWasParked(parked);
    setSettledGeometry(currentGeometry);
  }
  const morphing = settledGeometry !== currentGeometry;
  const closing = morphing && !largeShown && showsLarge(snapshot.previous);
  const surfaceExpanded = largeShown || closing;
  const transition = morphTransition(snapshot.previous, state, wide, reduceMotion);

  // The strip's scheduler pauses while the panel (or the drop row) covers it and resumes once
  // the collapse has settled, so whatever is due appears `collapseToActivityMs` later with
  // `notice` (docs/06-motion-spec.md "Panel → strip"; docs/modules/live-activities.md "Rules").
  const stripSuspended = useRef(false);
  useEffect(() => {
    if (largeShown) {
      if (!stripSuspended.current) {
        stripSuspended.current = true;
        setStripSuspended(true);
      }
      return;
    }
    if (morphing || !stripSuspended.current) {
      return;
    }
    const handle = window.setTimeout(() => {
      stripSuspended.current = false;
      setStripSuspended(false);
    }, timings.collapseToActivityMs);
    return () => {
      window.clearTimeout(handle);
    };
  }, [largeShown, morphing]);

  // While a morph is in flight the pointer stays interactive over both the old and the new
  // bounds; at rest (and after a layout change that moved nothing) the rects are the settled
  // ones. Parked publishes nothing; the first render after un-parking catches up.
  useEffect(() => {
    publishShapes(morphing);
  }, [morphing, publishShapes]);

  const onMorphStart = () => {
    sampler.current.start();
  };

  const onMorphComplete = () => {
    setSettledGeometry(currentGeometry);
    const report = sampler.current.stop(largeShown);
    // Mount and instant (reduced-motion) morphs span no frame: nothing worth logging.
    if (report !== null && report.frames > 0) {
      setLastMorph(report);
      reportMorph(report);
    }
  };

  // Parking unmounts the surface mid-morph, so its completion never arrives: end the sample
  // here or its frame loop would keep the renderer awake for as long as the shell stays parked.
  useEffect(() => {
    if (parked) {
      sampler.current.stop();
    }
  }, [parked]);

  useEffect(
    () => () => {
      sampler.current.stop();
    },
    [],
  );

  // --- pointer -------------------------------------------------------------------------------

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const point = { x: event.clientX, y: event.clientY };
    const speedPxPerS = speed.current.observe(point, event.timeStamp);
    const box = shellRef.current === null ? null : boxOf(shellRef.current);
    // Hovering a strip control is aiming at the control, not at the panel: no reveal intent.
    const overTrack = isStripControl(event.target);
    machine.send({
      type: 'pointer',
      inside: !overTrack && box !== null && contains(box, point),
      near: !overTrack && box !== null && contains(padded(box), point),
      speedPxPerS,
    });
  };

  const onPointerLeave = () => {
    speed.current.reset();
    machine.send({ type: 'pointerLeave' });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (isStripControl(event.target)) {
      // The control owns the press: a drag on the track or an answer on a pill, not the panel.
      return;
    }
    const box = shellRef.current === null ? null : boxOf(shellRef.current);
    const inside = box !== null && contains(box, { x: event.clientX, y: event.clientY });
    machine.send({ type: inside ? 'press' : 'pressOutside' });
  };

  const onWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (event.deltaY === 0) {
      return;
    }
    if (!largeShown && wheelNudgesVolume(hudSettings.scrollOnStrip, hudShowing)) {
      void commands.hudNudgeVolume(wheelVolumeDelta(event.deltaY)).catch(ignoreRefusal);
      return;
    }
    if (event.deltaY > 0) {
      machine.send({ type: 'scrollDown' });
    }
  };

  const onFocusIn = (event: ReactFocusEvent<HTMLElement>) => {
    if (isTextField(event.target)) {
      machine.send({ type: 'fieldFocus', focused: true });
    }
  };

  const onFocusOut = (event: ReactFocusEvent<HTMLElement>) => {
    if (isTextField(event.target) && !isTextField(event.relatedTarget)) {
      machine.send({ type: 'fieldFocus', focused: false });
    }
  };

  // --- render --------------------------------------------------------------------------------

  const shellStyle: MotionStyle = { top: layout.stripTopOffset, x: '-50%' };
  const contentTransition: Transition = reduceMotion
    ? reducedMotionTransition
    : { ...springs.content, delay: timings.contentEnterDelayMs / 1000 };
  const contentExit = {
    ...(reduceMotion ? contentRecipe.reducedExitTo : contentRecipe.exitTo),
    transition: contentExitTransition,
  };
  // Module switch (docs/06-motion-spec.md "Module switch"): the old body leaves in 80 ms, the
  // height springs with `switch` (see `morphTransition`), the new body enters 40 ms in.
  const moduleBodyTransition: Transition = reduceMotion
    ? reducedMotionTransition
    : { ...springs.content, delay: timings.moduleSwitchEnterDelayMs / 1000 };
  // The bar enters with `expand` 80 ms after the panel starts, and leaves with the content.
  const moduleBarTransition: Transition = reduceMotion
    ? reducedMotionTransition
    : { ...springs.expand, delay: timings.moduleBarEnterDelayMs / 1000 };
  const moduleBarExit = {
    ...(reduceMotion ? moduleBarRecipe.reducedExitTo : moduleBarRecipe.exitTo),
    transition: contentExitTransition,
  };
  // Snap zones fade in with `toggle` once the shape has started (motion spec "Window snap").
  const snapTransition: Transition = reduceMotion
    ? reducedMotionTransition
    : { ...springs.toggle, delay: timings.contentEnterDelayMs / 1000 };
  const moduleBarShown = panelShown && hasModuleBar;
  const panelTitle = paletteOpen
    ? t('shortcuts.palette.title')
    : activeModule === null
      ? t('app.name')
      : t(activeModule.titleKey);
  const ActivePanel = activeModule?.panel;
  const bodyKey = paletteOpen ? 'palette' : (activeModule?.id ?? 'empty');

  return (
    <main
      ref={rootRef}
      className="relative size-full overflow-clip"
      aria-label={t('app.name')}
      data-shape={layout.shape}
      data-yield={yieldState}
      data-state={state}
      hidden={parked}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
    >
      {!parked && (
        <motion.div
          ref={shellRef}
          data-testid="shell"
          className="absolute left-1/2"
          style={shellStyle}
          initial={false}
          animate={{
            width: target.width,
            height: target.height,
            y: offsetY,
            [notchMorphRadiusVar]: `${String(radius)}px`,
          }}
          transition={transition}
          onAnimationStart={onMorphStart}
          onAnimationComplete={onMorphComplete}
          onWheel={onWheel}
          onFocus={onFocusIn}
          onBlur={onFocusOut}
        >
          <NotchSurface
            shape={layout.shape}
            state={surfaceExpanded ? 'expanded' : 'collapsed'}
            morphing={morphing}
            style={{ width: '100%', height: '100%' }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {dropShown && DropSurface !== undefined && dropSession !== null ? (
                // Keyed by session so a new drag mounts a fresh row (its own hit-test and pulse).
                <motion.div
                  key={`drop-${String(dropSession.session)}`}
                  ref={dropRef}
                  data-testid="drop-row"
                  className="absolute top-0 left-1/2 w-max origin-top"
                  style={{ x: '-50%' }}
                  initial={
                    reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge
                  }
                  animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
                  exit={contentExit}
                  transition={contentTransition}
                >
                  <DropSurface
                    session={dropSession.session}
                    items={dropSession.items}
                    position={dropPosition ?? originPoint}
                    dropped={dropSession.dropped}
                    maxWidth={targetSize('expanded', geometry).width}
                    onDone={onDropDone}
                  />
                </motion.div>
              ) : snapShown && SnapSurface !== undefined && snapSession !== null ? (
                // Keyed by session so a new drag mounts fresh zones (their own hit-test).
                <motion.div
                  key={`snap-${String(snapSession.session)}`}
                  ref={snapRef}
                  data-testid="snap-row"
                  className="absolute top-0 left-1/2 w-max origin-top"
                  style={{ x: '-50%' }}
                  initial={
                    reduceMotion ? snapZoneRecipe.reducedEnterFrom : snapZoneRecipe.enterFrom
                  }
                  animate={reduceMotion ? snapZoneRecipe.reducedVisible : snapZoneRecipe.visible}
                  exit={contentExit}
                  transition={snapTransition}
                >
                  <SnapSurface
                    session={snapSession.session}
                    position={snapPosition ?? originPoint}
                    ended={snapEndedHere}
                    maxWidth={targetSize('expanded', geometry).width}
                    onDone={onSnapDone}
                  />
                </motion.div>
              ) : panelShown ? (
                <motion.div
                  key="panel"
                  ref={panelRef}
                  className="w-full origin-top"
                  initial={
                    reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge
                  }
                  animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
                  exit={contentExit}
                  transition={contentTransition}
                >
                  <Panel
                    title={panelTitle}
                    pinned={snapshot.pinnedByUser}
                    onPinChange={(pinned) => {
                      machine.send({ type: 'pin', pinned });
                    }}
                    onCollapse={() => {
                      machine.send({ type: 'collapse' });
                    }}
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.div
                        key={bodyKey}
                        className="size-full origin-top"
                        initial={
                          reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFrom
                        }
                        animate={
                          reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible
                        }
                        exit={contentExit}
                        transition={moduleBodyTransition}
                      >
                        {paletteOpen ? (
                          <CommandPalette
                            actions={paletteActions}
                            bindings={paletteBindings}
                            onRun={runFromPalette}
                          />
                        ) : (
                          (panelBody ??
                          (ActivePanel === undefined ? <PanelEmptyState /> : <ActivePanel />))
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </Panel>
                </motion.div>
              ) : (
                <motion.div
                  key="strip"
                  className="size-full origin-top"
                  initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFrom}
                  animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
                  exit={contentExit}
                  transition={contentTransition}
                >
                  <Strip content={content} receivedAt={contentAt} hud={hud} decision={decision} />
                </motion.div>
              )}
            </AnimatePresence>
          </NotchSurface>
        </motion.div>
      )}
      {!parked && (
        <AnimatePresence initial={false}>
          {moduleBarShown && (
            // Rides the panel's bottom edge: the same spring as the shell, from under the strip.
            <motion.div
              key="module-bar"
              data-testid="module-bar"
              className="absolute left-1/2"
              style={shellStyle}
              initial={{ y: moduleBarOffsetY(snapshot.previous, geometry) }}
              animate={{ y: moduleBarOffsetY(state, geometry) }}
              transition={transition}
            >
              <motion.div
                initial={
                  reduceMotion ? moduleBarRecipe.reducedEnterFrom : moduleBarRecipe.enterFrom
                }
                animate={reduceMotion ? moduleBarRecipe.reducedVisible : moduleBarRecipe.visible}
                exit={moduleBarExit}
                transition={moduleBarTransition}
              >
                <ModuleBar
                  aria-label={t('notch.modules')}
                  overflowLabel={t('notch.moreModules')}
                  items={moduleBarItems}
                  activeId={activeModule?.id ?? null}
                  onActivate={activateModule}
                  onReorder={setModuleOrder}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {hitTestOverlayEnabled && (
        <HitTestOverlay rects={publishedRects} state={state} morph={lastMorph} />
      )}
    </main>
  );
}
