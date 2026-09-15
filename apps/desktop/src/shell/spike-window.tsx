import type { MorphReport, ShapeRect } from '@muna/contracts';
import { commands, events } from '@muna/contracts';
import { springs } from '@muna/ui/motion';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Strip and panel geometry in CSS px (docs/modules/notch-shell.md sizes, Island bottom radii). */
export const STRIP_SHAPE = { width: 200, height: 32, radius: 14 } as const;
export const PANEL_SHAPE = { width: 360, height: 240, radius: 28 } as const;

const FRAME_MS = 1000 / 60;
const DROPPED_FRAME_FACTOR = 1.5;

interface FrameSample {
  start: number;
  last: number;
  frames: number;
  maxFrameMs: number;
  droppedFrames: number;
  raf: number;
}

const toShapeRect = (rect: DOMRect): ShapeRect => ({
  x: Math.round(rect.left),
  y: Math.round(rect.top),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
});

/** Rect the shape will occupy once `expanded` settles, without waiting for the spring. */
const targetRect = (current: DOMRect, expanded: boolean): ShapeRect => {
  const shape = expanded ? PANEL_SHAPE : STRIP_SHAPE;
  const centre = current.left + current.width / 2;
  return {
    x: Math.round(centre - shape.width / 2),
    y: Math.round(current.top),
    width: shape.width,
    height: shape.height,
  };
};

/** Smallest rect containing both. */
const union = (a: ShapeRect, b: ShapeRect): ShapeRect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

const ignoreIpcFailure = () => {
  // Not running inside Tauri (tests, Storybook): the spike has nothing to report to.
};

/**
 * The M0-E2 window spike UI: one black shape that morphs strip ↔ panel on `MorphRequested`,
 * publishes its painted bounds for hit-testing and reports frame statistics per morph.
 * Not a product surface — `NotchWindow` is.
 */
export function SpikeWindow() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const shapeRef = useRef<HTMLDivElement>(null);
  const sample = useRef<FrameSample | null>(null);

  const publishShapes = useCallback((rects: ShapeRect[]) => {
    commands.publishShapeRects(rects).then(ignoreIpcFailure, ignoreIpcFailure);
  }, []);

  const publishCurrentShape = useCallback(() => {
    const node = shapeRef.current;
    if (node) {
      publishShapes([toShapeRect(node.getBoundingClientRect())]);
    }
  }, [publishShapes]);

  // Ready = first painted frame: two animation frames after mount (docs/modules/notch-shell.md,
  // "moved into place after the UI reports ready").
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        publishCurrentShape();
        commands.shellReady().then(ignoreIpcFailure, ignoreIpcFailure);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [publishCurrentShape]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    events.morphRequested
      .listen((event) => {
        setExpanded(event.payload.expanded);
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(ignoreIpcFailure);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const stopSampling = useCallback((): FrameSample | null => {
    const current = sample.current;
    if (current) {
      cancelAnimationFrame(current.raf);
      sample.current = null;
    }
    return current;
  }, []);

  useEffect(
    () => () => {
      stopSampling();
    },
    [stopSampling],
  );

  const onMorphStart = () => {
    const node = shapeRef.current;
    if (node) {
      // While in flight, keep both the current and the target bounds interactive.
      const current = node.getBoundingClientRect();
      publishShapes([union(toShapeRect(current), targetRect(current, expanded))]);
    }
    stopSampling();
    const now = performance.now();
    const state: FrameSample = {
      start: now,
      last: now,
      frames: 0,
      maxFrameMs: 0,
      droppedFrames: 0,
      raf: 0,
    };
    const tick = (time: number) => {
      const delta = time - state.last;
      state.last = time;
      state.frames += 1;
      state.maxFrameMs = Math.max(state.maxFrameMs, delta);
      if (delta > FRAME_MS * DROPPED_FRAME_FACTOR) {
        state.droppedFrames += 1;
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    sample.current = state;
  };

  const onMorphComplete = () => {
    publishCurrentShape();
    const state = stopSampling();
    if (!state) {
      return;
    }
    const report: MorphReport = {
      expanded,
      frames: state.frames,
      durationUs: Math.round((state.last - state.start) * 1000),
      maxFrameUs: Math.round(state.maxFrameMs * 1000),
      droppedFrames: state.droppedFrames,
    };
    commands.reportMorph(report).then(ignoreIpcFailure, ignoreIpcFailure);
  };

  const shape = expanded ? PANEL_SHAPE : STRIP_SHAPE;

  return (
    <main className="flex h-full items-start justify-center" aria-label={t('spike.label')}>
      <motion.div
        ref={shapeRef}
        role="region"
        aria-label={t(expanded ? 'spike.panel' : 'spike.strip')}
        data-expanded={expanded}
        className="bg-notch-black"
        style={{ overflow: 'clip', contain: 'layout paint style' }}
        initial={false}
        animate={{
          width: shape.width,
          height: shape.height,
          borderBottomLeftRadius: shape.radius,
          borderBottomRightRadius: shape.radius,
        }}
        transition={expanded ? springs.expand : springs.collapse}
        onAnimationStart={onMorphStart}
        onAnimationComplete={onMorphComplete}
      >
        <span className="sr-only">{t('spike.hint')}</span>
      </motion.div>
    </main>
  );
}
