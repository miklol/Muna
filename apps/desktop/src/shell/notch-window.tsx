import type { MorphReport, ShapeRect, ShellLayout } from '@muna/contracts';
import { STRIP_HEIGHT_PX } from '@muna/contracts';
import {
  contentExitTransition,
  contentRecipe,
  moduleBarRecipe,
  reducedMotionTransition,
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

import { persistSettings, useSettings } from '../lib/settings';
import { type ModuleDefinition, modules as registeredModules } from '../modules/registry';
import { useAppStore } from '../store/app-store';
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
import { Panel, PanelEmptyState } from './panel';
import {
  type GeometryInput,
  moduleBarOffsetY,
  moduleBarSize,
  showsPanel,
  targetOffsetY,
  targetSize,
} from './shell-geometry';
import { Strip } from './strip';
import { wantsWide } from './strip-content';
import {
  publishShapeRects,
  reportMorph,
  setNotchFocusable,
  setStripSuspended,
  useShellLayoutSubscription,
  useShellPointerDownOutsideSubscription,
  useShellReady,
  useShellToggleSubscription,
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
  const speed = useRef(new SpeedTracker());
  const sampler = useRef(new MorphSampler());
  const lastPublished = useRef<ShapeRect[]>([]);

  const [panelContentHeight, setPanelContentHeight] = useState<number | null>(null);
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

  // --- yield, hotkey and click-through clicks come from Rust ------------------------------

  useEffect(() => {
    machine.send({ type: 'yield', state: yieldState });
  }, [machine, yieldState]);

  useShellToggleSubscription(
    useCallback(() => {
      machine.send({ type: 'toggle' });
    }, [machine]),
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

  // Ctrl+Tab / Ctrl+Shift+Tab step through the modules while the panel is open
  // (docs/modules/notch-shell.md, "Rules").
  const panelShown = showsPanel(state);
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

  const wide = !panelShown && wantsWide(content);
  const geometry = useMemo<GeometryInput>(
    () => ({ layout, wide, panelContentHeight }),
    [layout, wide, panelContentHeight],
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
  // material follows: the panel's while a panel shows or is still collapsing, black otherwise
  // (they are alike at strip size, where the switch happens).
  const radius = panelShown ? radii.panel : radii.strip;
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
  const closing = morphing && !panelShown && showsPanel(snapshot.previous);
  const surfaceExpanded = panelShown || closing;
  const transition = morphTransition(snapshot.previous, state, wide, reduceMotion);

  // The strip's scheduler pauses while the panel covers it and resumes once the collapse has
  // settled, so whatever is due appears `collapseToActivityMs` later with `notice`
  // (docs/06-motion-spec.md "Panel → strip"; docs/modules/live-activities.md "Rules").
  const stripSuspended = useRef(false);
  useEffect(() => {
    if (panelShown) {
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
  }, [morphing, panelShown]);

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
    const report = sampler.current.stop(panelShown);
    // Mount and instant (reduced-motion) morphs span no frame: nothing worth logging.
    if (report !== null && report.frames > 0) {
      setLastMorph(report);
      reportMorph(report);
    }
  };

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
    machine.send({
      type: 'pointer',
      inside: box !== null && contains(box, point),
      near: box !== null && contains(padded(box), point),
      speedPxPerS,
    });
  };

  const onPointerLeave = () => {
    speed.current.reset();
    machine.send({ type: 'pointerLeave' });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const box = shellRef.current === null ? null : boxOf(shellRef.current);
    const inside = box !== null && contains(box, { x: event.clientX, y: event.clientY });
    machine.send({ type: inside ? 'press' : 'pressOutside' });
  };

  const onWheel = (event: ReactWheelEvent<HTMLElement>) => {
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
  const moduleBarShown = panelShown && hasModuleBar;
  const panelTitle = activeModule === null ? t('app.name') : t(activeModule.titleKey);
  const ActivePanel = activeModule?.panel;

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
              {panelShown ? (
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
                        key={activeModule?.id ?? 'empty'}
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
                        {panelBody ??
                          (ActivePanel === undefined ? <PanelEmptyState /> : <ActivePanel />)}
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
                  <Strip content={content} receivedAt={contentAt} />
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
                  onActivate={setActiveModule}
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
