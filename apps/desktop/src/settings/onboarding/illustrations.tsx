import type { NotchShape, PlacementMode } from '@muna/contracts';
import { NotchSurface } from '@muna/ui';
import { useMotionPreset } from '@muna/ui/motion';
import { motion } from 'motion/react';

/**
 * The illustration's geometry, in its own px: an exaggerated strip so the placement trade-off
 * reads at 240 px wide. Mirrors the custom properties in onboarding.css.
 */
export const screenArt = {
  stripHeight: 14,
  /** The sliver left visible while the strip yields (docs/modules/notch-shell.md, "peek"). */
  peekHeight: 3,
} as const;

interface StripProps {
  shape: NotchShape;
  /** Slide in the illustration's px; `0` at rest, negative while yielding. */
  y: number;
}

function Strip({ shape, y }: StripProps) {
  // Peek ↔ strip is the `reveal` spring in the real shell too (docs/06-motion-spec.md).
  const transition = useMotionPreset('reveal');
  return (
    <motion.div
      className={
        shape === 'island'
          ? 'onboarding-screen__strip onboarding-screen__strip--island'
          : 'onboarding-screen__strip'
      }
      initial={false}
      animate={{ y }}
      transition={transition}
    >
      <NotchSurface shape={shape} state="collapsed" className="onboarding-screen__surface" />
    </motion.div>
  );
}

interface WindowProps {
  /** Where the window's top edge sits: `0` under the strip, `stripHeight` below a reserved band. */
  y: number;
}

function Window({ y }: WindowProps) {
  const transition = useMotionPreset('layout');
  return (
    <motion.div
      className="onboarding-screen__window"
      initial={false}
      animate={{ y }}
      transition={transition}
    >
      <span className="onboarding-screen__titlebar">
        <span className="onboarding-screen__tab onboarding-screen__tab--active" />
        <span className="onboarding-screen__tab onboarding-screen__tab--idle" />
        <span className="onboarding-screen__tab onboarding-screen__tab--idle" />
      </span>
    </motion.div>
  );
}

export interface ShapeArtProps {
  shape: NotchShape;
}

/** A 96 × 56 desktop with the strip alone on its edge, for the shape tiles. */
export function ShapeArt({ shape }: ShapeArtProps) {
  return (
    <div aria-hidden="true" className="onboarding-screen onboarding-screen--small">
      <Strip shape={shape} y={0} />
    </div>
  );
}

export interface PlacementArtProps {
  mode: PlacementMode;
  shape: NotchShape;
  /** Without a window the desktop is empty and the strip rests, whatever the mode. */
  window?: boolean;
}

/**
 * The placement explainer. Overlay: a maximised window reaches the top edge and the strip
 * yields to a peek line over its title bar. Reserved: the window starts below the strip's
 * band and the strip stays whole. Driven by the selected tile — no loop, no timer — so it
 * animates exactly when the choice changes and costs nothing at rest.
 */
export function PlacementArt({ mode, shape, window = true }: PlacementArtProps) {
  const yielding = window && mode === 'overlay';
  return (
    <div aria-hidden="true" className="onboarding-screen">
      {window && <Window y={mode === 'reserved' ? screenArt.stripHeight : 0} />}
      <Strip shape={shape} y={yielding ? -(screenArt.stripHeight - screenArt.peekHeight) : 0} />
    </div>
  );
}
