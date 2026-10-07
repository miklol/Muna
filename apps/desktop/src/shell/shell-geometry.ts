import type { ShellLayout } from '@muna/contracts';
import { PEEK_HEIGHT_PX } from '@muna/contracts';

import type { ShellState } from './machine';

/**
 * Shell silhouette sizes in CSS px from docs/05-design-system.md ("Spacing & sizing") and
 * docs/06-motion-spec.md ("Strip → panel"). One place, so the morph targets, the published
 * hit rects and the tests agree.
 */
export const shellSizes = {
  /** Strip width at rest (`--size-strip-width`). */
  stripWidth: 200,
  /** Wide form (live activity text) grows the strip up to this. */
  stripWideWidth: 420,
  /** Hover reveal grows the strip by this much (`reveal` preset: +16 w, +4 h). */
  revealGrowWidth: 16,
  revealGrowHeight: 4,
  /**
   * Visible sliver while a yield rule asks for Peek (`--size-peek-height`). Shared with the
   * shell, whose hit tester slides the strip's rect up by the same amount.
   */
  peekHeight: PEEK_HEIGHT_PX,
  /**
   * Preferred panel width. Rust already clamps `panelMaxWidth` to `min(1000, monitor − 80)`
   * (`shell/layout.rs`); the UI never widens past that bound, so a narrow work area gets a
   * panel that fits instead of one clipped by the window edge.
   */
  panelWidth: 1000,
  /** Panel height follows content between these. */
  panelMinHeight: 190,
  panelMaxHeight: 360,
  /** The module bar pill under the panel (`--size-module-bar-*`) and its gap to the panel. */
  moduleBarWidth: 640,
  moduleBarHeight: 40,
  moduleBarGap: 12,
} as const;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface GeometryInput {
  readonly layout: Pick<ShellLayout, 'stripHeight' | 'stripTopOffset' | 'panelMaxWidth'>;
  /** The strip shows wide-form text. */
  readonly wide: boolean;
  /** Natural height of the panel content, when known. */
  readonly panelContentHeight: number | null;
  /**
   * Natural size of the drop tiles (docs/modules/drop-actions.md), when known: the row lays
   * out at its own width — up to the panel's — and the shell morphs to match, like the panel.
   */
  readonly dropContentSize?: Size | null;
  /**
   * Natural size of the snap zones (docs/modules/window-snap.md), when known; measured and
   * morphed to like the drop row.
   */
  readonly snapContentSize?: Size | null;
}

/** Every silhouette fits the bound the shell supplied; nothing paints past the window. */
const fit = (width: number, { layout }: GeometryInput): number =>
  Math.min(width, layout.panelMaxWidth);

export const stripSize = (input: GeometryInput): Size => ({
  width: fit(input.wide ? shellSizes.stripWideWidth : shellSizes.stripWidth, input),
  height: input.layout.stripHeight,
});

export const revealSize = (input: GeometryInput): Size => {
  const strip = stripSize(input);
  return {
    width: fit(strip.width + shellSizes.revealGrowWidth, input),
    height: strip.height + shellSizes.revealGrowHeight,
  };
};

export const panelSize = (input: GeometryInput): Size => ({
  width: fit(shellSizes.panelWidth, input),
  height: Math.min(
    shellSizes.panelMaxHeight,
    Math.max(shellSizes.panelMinHeight, input.panelContentHeight ?? 0),
  ),
});

/**
 * The drop row takes the size its tiles measure, no wider than the panel; until it has laid
 * out (the first frame after a drag enters) the strip's size stands in, so the morph starts
 * from where the strip is.
 */
export const dropSize = (input: GeometryInput): Size =>
  measuredSize(input.dropContentSize ?? null, input);

/** The snap zones, likewise (docs/modules/window-snap.md). */
export const snapSize = (input: GeometryInput): Size =>
  measuredSize(input.snapContentSize ?? null, input);

const measuredSize = (measured: Size | null, input: GeometryInput): Size => {
  if (measured === null || measured.width === 0 || measured.height === 0) {
    return stripSize(input);
  }
  return {
    width: Math.min(measured.width, panelSize(input).width),
    height: measured.height,
  };
};

/** The size the shell node animates to in `state`. */
export const targetSize = (state: ShellState, input: GeometryInput): Size => {
  switch (state) {
    case 'expanded':
    case 'pinned':
      return panelSize(input);
    case 'hoverReveal':
      return revealSize(input);
    case 'drop':
      return dropSize(input);
    case 'snap':
      return snapSize(input);
    default:
      return stripSize(input);
  }
};

/**
 * Vertical translation of the shell node: Peek slides it up until only the sliver shows at the
 * top edge, whatever the shape's own top offset.
 */
export const targetOffsetY = (state: ShellState, input: GeometryInput): number =>
  state === 'peek'
    ? -(input.layout.stripTopOffset + input.layout.stripHeight - shellSizes.peekHeight)
    : 0;

/** Whether `state` shows the panel (as opposed to the strip in one of its forms). */
export const showsPanel = (state: ShellState): boolean =>
  state === 'expanded' || state === 'pinned';

/** Whether `state` shows the drop tiles (docs/modules/drop-actions.md). */
export const showsDrop = (state: ShellState): boolean => state === 'drop';

/** Whether `state` shows the snap zones (docs/modules/window-snap.md). */
export const showsSnap = (state: ShellState): boolean => state === 'snap';

/**
 * Whether `state` is one of the large silhouettes — the panel, the drop row or the snap zones
 * — that take the panel material and hide the strip, as opposed to a strip form.
 */
export const showsLarge = (state: ShellState): boolean =>
  showsPanel(state) || showsDrop(state) || showsSnap(state);

/** The module bar pill, no wider than the panel it hangs under. */
export const moduleBarSize = (input: GeometryInput): Size => ({
  width: fit(shellSizes.moduleBarWidth, input),
  height: shellSizes.moduleBarHeight,
});

/**
 * Top of the module bar relative to the shell node's top: it hangs `moduleBarGap` under the
 * silhouette the shell is animating to, so it rides the panel's bottom edge through a morph.
 */
export const moduleBarOffsetY = (state: ShellState, input: GeometryInput): number =>
  targetSize(state, input).height + shellSizes.moduleBarGap;
