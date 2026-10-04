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
  IconButton,
  ModuleBar,
  type ModuleBarItem,
  NotchSurface,
  notchMorphRadiusVar,
  PanelChrome,
  SegmentedControl,
  StripView,
} from '@muna/ui/primitives';
import { Minimize2, Music, Pin, PinOff, SquareCheck, Timer } from 'lucide-react';
import { AnimatePresence, motion, type Transition } from 'motion/react';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  activityForm,
  activityForms,
  type DemoActivity,
  type DemoModule,
  type DemoShape,
  ICON_STROKE,
} from './demo-content';
import { MediaBody, moduleTitles, PomodoroBody, TodoBody } from './demo-panels';

export type DemoState = 'collapsed' | 'reveal' | 'expanded';

/** The stage the demo is laid out on; it scales down to fit narrower columns. */
export const demoStage = { width: 760, height: 336 } as const;

/**
 * The shell's sizes at the strip's default height (docs/05-design-system.md "Spacing &
 * sizing"; `shellSizes` in the app): strip 200 × 32, hover reveal +16 × +4, the panel at its
 * minimum width and a content height inside the 190–360 clamp.
 */
export const demoSizes = {
  strip: { width: 200, height: 32 },
  reveal: { width: 216, height: 36 },
  panel: { width: 720, height: 236 },
  islandTopOffset: 8,
  moduleBarGap: 8,
  radii: { strip: 14, panel: 28 },
} as const;

export const demoSize = (state: DemoState): { readonly width: number; readonly height: number } =>
  state === 'expanded' ? demoSizes.panel : state === 'reveal' ? demoSizes.reveal : demoSizes.strip;

/**
 * The shell's `morphTransition`, reduced to the demo's three states: `expand` into the panel,
 * `collapse` out of it once the content has left (`shapeFollowDelayMs`), `reveal` otherwise.
 */
export const demoMorphTransition = (
  from: DemoState,
  to: DemoState,
  reduceMotion: boolean,
): Transition => {
  if (reduceMotion) return reducedMotionTransition;
  if (to === 'expanded' && from !== 'expanded') return springs.expand;
  if (from === 'expanded' && to !== 'expanded') {
    return { ...springs.collapse, delay: timings.shapeFollowDelayMs / 1000 };
  }
  return springs.reveal;
};

/** Hover-out grace before the shape collapses (docs/06-motion-spec.md "Hover intent"). */
export const hoverOutGraceMs = (state: DemoState): number =>
  state === 'expanded' ? timings.hoverOutGraceExpandedMs : timings.hoverOutGraceRevealMs;

interface LiveSnapshot {
  /** The demo is on screen in a visible tab: animations may run. */
  readonly live: boolean;
  /** `Date.now()` when it last became live; the countdowns count from here. */
  readonly since: number;
}

interface LiveStore {
  readonly subscribe: (onChange: () => void) => () => void;
  readonly getSnapshot: () => LiveSnapshot;
  readonly attach: (element: HTMLElement | null) => void;
}

const idle: LiveSnapshot = { live: false, since: 0 };

/**
 * Whether the demo may animate: in the viewport and in a visible document. Nothing ticks or
 * samples otherwise — the site keeps the app's rule that timers stop when not visible.
 */
const createLiveStore = (): LiveStore => {
  const hasObserver = typeof IntersectionObserver !== 'undefined';
  let inView = !hasObserver;
  let visible = document.visibilityState !== 'hidden';
  let snapshot = idle;
  let element: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  const listeners = new Set<() => void>();

  const publish = () => {
    const live = inView && visible;
    if (live === snapshot.live) return;
    snapshot = live ? { live, since: Date.now() } : idle;
    for (const listener of listeners) listener();
  };
  const observe = () => {
    observer?.disconnect();
    observer = null;
    if (!hasObserver || element === null || listeners.size === 0) return;
    observer = new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      publish();
    });
    observer.observe(element);
  };
  const onVisibility = () => {
    visible = document.visibilityState !== 'hidden';
    publish();
  };

  return {
    subscribe: (onChange) => {
      listeners.add(onChange);
      if (listeners.size === 1) {
        document.addEventListener('visibilitychange', onVisibility);
        observe();
        publish();
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
          document.removeEventListener('visibilitychange', onVisibility);
          observe();
        }
      };
    },
    getSnapshot: () => snapshot,
    attach: (next) => {
      if (next === element) return;
      element = next;
      observe();
    },
  };
};

const noop = () => undefined;

const moduleIcons: Readonly<Record<DemoModule, ModuleBarItem>> = {
  media: { id: 'media', label: 'Media', icon: <Music strokeWidth={ICON_STROKE} /> },
  pomodoro: { id: 'pomodoro', label: 'Pomodoro', icon: <Timer strokeWidth={ICON_STROKE} /> },
  todo: { id: 'todo', label: 'Todo', icon: <SquareCheck strokeWidth={ICON_STROKE} /> },
};

const isDemoModule = (id: string): id is DemoModule => id in moduleIcons;

const shapeItems = [
  { id: 'notch', label: 'Notch' },
  { id: 'island', label: 'Island' },
] as const;

/**
 * The notch, alive on the page: the same `NotchSurface`, `StripView`, `PanelChrome` and
 * `ModuleBar` as the app, driven by a three-state copy of the shell's hover choreography.
 * Hover with intent to reveal, rest to open, move away to collapse; click or press Enter to
 * toggle; Escape closes; pin keeps it open. Everything honours reduced motion through the
 * `MunaMotionProvider` above it.
 */
export function NotchDemo() {
  const reduceMotion = useReduceMotion();
  const [liveStore] = useState(createLiveStore);
  const { live, since } = useSyncExternalStore(
    liveStore.subscribe,
    liveStore.getSnapshot,
    () => idle,
  );
  const attachStage = useCallback(
    (element: HTMLDivElement | null) => {
      liveStore.attach(element);
    },
    [liveStore],
  );

  const [machine, setMachine] = useState<{ state: DemoState; previous: DemoState }>({
    state: 'collapsed',
    previous: 'collapsed',
  });
  const { state, previous } = machine;
  const [morphing, setMorphing] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [activity, setActivity] = useState<DemoActivity>('media');
  const [shape, setShape] = useState<DemoShape>('notch');
  const [activeModule, setActiveModule] = useState<DemoModule>('media');
  const [order, setOrder] = useState<readonly DemoModule[]>(['media', 'pomodoro', 'todo']);
  const [scale, setScale] = useState(1);

  const frameRef = useRef<HTMLDivElement>(null);
  const stripButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const focusAfter = useRef<'strip' | 'panel' | null>(null);

  const go = useCallback((next: DemoState) => {
    setMachine((current) =>
      current.state === next ? current : { state: next, previous: current.state },
    );
  }, []);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  const collapse = useCallback(
    (viaKeyboard: boolean) => {
      clearHoverTimer();
      setPinned(false);
      if (viaKeyboard) focusAfter.current = 'strip';
      go('collapsed');
    },
    [clearHoverTimer, go],
  );

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  // Escape closes the notch from anywhere inside the stage, like the app's shell.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null || state === 'collapsed') return noop;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        collapse(true);
      }
    };
    frame.addEventListener('keydown', onKeyDown);
    return () => {
      frame.removeEventListener('keydown', onKeyDown);
    };
  }, [collapse, state]);

  // The stage is designed at 760 px and scales to the column, so the notch keeps the app's
  // proportions on a phone as well as a desktop.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null || typeof ResizeObserver === 'undefined') return noop;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentBoxSize[0]?.inlineSize ?? frame.clientWidth;
      setScale(Math.min(1, width / demoStage.width));
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Keyboard users land where they can act: the panel's first control after opening, the
  // strip after closing.
  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    if (target === 'panel' && state === 'expanded') {
      panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    } else if (target === 'strip' && state === 'collapsed') {
      stripButtonRef.current?.focus();
    }
  }, [state]);

  const onPointerEnter = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || state === 'expanded') return;
    clearHoverTimer();
    // Rest for the hover-intent delay to reveal, then for the rest-to-open delay to expand.
    hoverTimer.current = window.setTimeout(() => {
      go('reveal');
      hoverTimer.current = window.setTimeout(() => {
        go('expanded');
      }, timings.revealToExpandMs);
    }, timings.hoverIntentMs);
  };

  const onPointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    clearHoverTimer();
    if (pinned || state === 'collapsed') return;
    hoverTimer.current = window.setTimeout(() => {
      go('collapsed');
    }, hoverOutGraceMs(state));
  };

  const toggle = (viaKeyboard: boolean) => {
    clearHoverTimer();
    if (state === 'expanded') {
      if (viaKeyboard) focusAfter.current = 'strip';
      go('collapsed');
    } else {
      if (viaKeyboard) focusAfter.current = 'panel';
      go('expanded');
    }
  };

  const pickActivity = (next: DemoActivity) => {
    setActivity(next);
    setActiveModule(activityForm(next).module);
  };

  const form = activityForm(activity);
  const size = demoSize(state);
  const expanded = state === 'expanded';
  const closing = morphing && !expanded && previous === 'expanded';
  const surfaceExpanded = expanded || closing;
  const radius = surfaceExpanded ? demoSizes.radii.panel : demoSizes.radii.strip;
  const transition = demoMorphTransition(previous, state, reduceMotion);
  const contentTransition: Transition = reduceMotion
    ? reducedMotionTransition
    : { ...springs.content, delay: timings.contentEnterDelayMs / 1000 };
  const moduleBodyTransition: Transition = reduceMotion
    ? reducedMotionTransition
    : { ...springs.content, delay: timings.moduleSwitchEnterDelayMs / 1000 };
  const moduleBarTransition: Transition = reduceMotion
    ? reducedMotionTransition
    : { ...springs.expand, delay: timings.moduleBarEnterDelayMs / 1000 };
  const contentExit = {
    ...(reduceMotion ? contentRecipe.reducedExitTo : contentRecipe.exitTo),
    transition: contentExitTransition,
  };
  const moduleBarExit = {
    ...(reduceMotion ? moduleBarRecipe.reducedExitTo : moduleBarRecipe.exitTo),
    transition: contentExitTransition,
  };
  const top = shape === 'island' ? demoSizes.islandTopOffset : 0;
  const moduleBarItems = order.map((id) => moduleIcons[id]);

  return (
    <div className="demo" data-state={state} data-shape={shape}>
      <div ref={frameRef} className="demo__frame" style={{ maxWidth: demoStage.width }}>
        <div
          ref={attachStage}
          className="demo__stage"
          style={{
            width: demoStage.width,
            height: demoStage.height,
            transform: `scale(${String(scale)})`,
            marginBottom: -(demoStage.height * (1 - scale)),
          }}
        >
          <div className="demo__wallpaper" aria-hidden="true">
            <div className="demo__window">
              <div className="demo__window-bar">
                <span className="demo__window-title">Documents</span>
                <span className="demo__window-controls">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </div>
          </div>

          <div
            className="demo__hover-zone"
            style={{ paddingInline: timings.hoverPaddingPx, paddingBottom: timings.hoverPaddingPx }}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
          >
            <motion.div
              className="demo__shell"
              style={{ top }}
              initial={false}
              animate={{
                width: size.width,
                height: size.height,
                [notchMorphRadiusVar]: `${String(radius)}px`,
              }}
              transition={transition}
              onAnimationStart={() => {
                setMorphing(true);
              }}
              onAnimationComplete={() => {
                setMorphing(false);
              }}
            >
              <NotchSurface
                shape={shape}
                state={surfaceExpanded ? 'expanded' : 'collapsed'}
                morphing={morphing}
                style={{ width: '100%', height: '100%' }}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  {expanded ? (
                    <motion.div
                      key="panel"
                      ref={panelRef}
                      className="demo__panel"
                      initial={
                        reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge
                      }
                      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
                      exit={contentExit}
                      transition={contentTransition}
                    >
                      <PanelChrome
                        title={moduleTitles[activeModule]}
                        className="demo__panel-chrome"
                        rail={
                          <>
                            <IconButton
                              aria-label={pinned ? 'Unpin the panel' : 'Pin the panel open'}
                              aria-pressed={pinned}
                              isActive={pinned}
                              onPress={() => {
                                setPinned((value) => !value);
                              }}
                            >
                              {pinned ? (
                                <PinOff strokeWidth={ICON_STROKE} />
                              ) : (
                                <Pin strokeWidth={ICON_STROKE} />
                              )}
                            </IconButton>
                            <IconButton
                              aria-label="Collapse the panel"
                              onPress={(event) => {
                                collapse(event.pointerType === 'keyboard');
                              }}
                            >
                              <Minimize2 strokeWidth={ICON_STROKE} />
                            </IconButton>
                          </>
                        }
                      >
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.div
                            key={activeModule}
                            className="demo__body"
                            initial={
                              reduceMotion
                                ? contentRecipe.reducedEnterFrom
                                : contentRecipe.enterFrom
                            }
                            animate={
                              reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible
                            }
                            exit={contentExit}
                            transition={moduleBodyTransition}
                          >
                            {activeModule === 'media' ? (
                              <MediaBody live={live} />
                            ) : activeModule === 'pomodoro' ? (
                              <PomodoroBody live={live} receivedAt={since} />
                            ) : (
                              <TodoBody />
                            )}
                          </motion.div>
                        </AnimatePresence>
                      </PanelChrome>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="strip"
                      className="demo__strip"
                      initial={
                        reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFrom
                      }
                      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
                      exit={contentExit}
                      transition={contentTransition}
                    >
                      <StripView
                        aria-label="Notch strip"
                        itemId={form.id}
                        kind={form.kind}
                        leading={form.leading(live, since)}
                        trailing={form.trailing(live, since)}
                        description={form.description}
                      />
                      <button
                        ref={stripButtonRef}
                        type="button"
                        className="demo__strip-button"
                        aria-label="Open the notch"
                        onClick={(event) => {
                          toggle(event.detail === 0);
                        }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </NotchSurface>
            </motion.div>

            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  key="module-bar"
                  className="demo__module-bar"
                  style={{ top: top + demoSizes.panel.height + demoSizes.moduleBarGap }}
                  initial={
                    reduceMotion ? moduleBarRecipe.reducedEnterFrom : moduleBarRecipe.enterFrom
                  }
                  animate={reduceMotion ? moduleBarRecipe.reducedVisible : moduleBarRecipe.visible}
                  exit={moduleBarExit}
                  transition={moduleBarTransition}
                >
                  <ModuleBar
                    aria-label="Modules"
                    overflowLabel="More modules"
                    items={moduleBarItems}
                    activeId={activeModule}
                    onActivate={(id) => {
                      if (isDemoModule(id)) setActiveModule(id);
                    }}
                    onReorder={(ids) => {
                      setOrder(ids.filter(isDemoModule));
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="demo__controls">
        <div className="demo__control">
          <span className="demo__control-label" aria-hidden="true">
            In the strip
          </span>
          <SegmentedControl
            aria-label="What the strip shows"
            className="demo__segmented demo__segmented--activity"
            items={activityForms.map((item) => ({
              id: item.id,
              label: item.label,
              icon: item.icon,
            }))}
            value={activity}
            onChange={pickActivity}
          />
        </div>
        <div className="demo__control">
          <span className="demo__control-label" aria-hidden="true">
            Shape
          </span>
          <SegmentedControl
            aria-label="Notch shape"
            items={shapeItems}
            value={shape}
            onChange={setShape}
          />
        </div>
        <p className="demo__hint">
          Hover to peek, rest to open, move away to close. With a keyboard, Tab to the notch and
          press Enter; Escape closes it.
        </p>
      </div>
    </div>
  );
}
