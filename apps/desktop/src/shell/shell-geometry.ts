import type { ShellLayout } from '@muna/contracts';

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
  /** Visible sliver while a yield rule asks for Peek (`--size-peek-height`). */
  peekHeight: 6,
  /** Panel width clamps to `clamp(720, monitor − 80, 1000)`; the shell supplies the upper bound. */
  panelMinWidth: 720,
  /** Panel height follows content between these. */
  panelMinHeight: 190,
  panelMaxHeight: 360,
} as const;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface GeometryInput {
  readonly layout: Pick<ShellLayout, 'stripHeight' | 'panelMaxWidth'>;
  /** The strip shows wide-form text. */
  readonly wide: boolean;
  /** Natural height of the panel content, when known. */
  readonly panelContentHeight: number | null;
}

export const stripSize = ({ layout, wide }: GeometryInput): Size => ({
  width: wide ? shellSizes.stripWideWidth : shellSizes.stripWidth,
  height: layout.stripHeight,
});

export const revealSize = (input: GeometryInput): Size => {
  const strip = stripSize(input);
  return {
    width: strip.width + shellSizes.revealGrowWidth,
    height: strip.height + shellSizes.revealGrowHeight,
  };
};

export const panelSize = ({ layout, panelContentHeight }: GeometryInput): Size => ({
  width: Math.max(shellSizes.panelMinWidth, layout.panelMaxWidth),
  height: Math.min(
    shellSizes.panelMaxHeight,
    Math.max(shellSizes.panelMinHeight, panelContentHeight ?? 0),
  ),
});

/** The size the shell node animates to in `state`. */
export const targetSize = (state: ShellState, input: GeometryInput): Size => {
  switch (state) {
    case 'expanded':
    case 'pinned':
      return panelSize(input);
    case 'hoverReveal':
      return revealSize(input);
    default:
      return stripSize(input);
  }
};

/** Vertical translation of the shell node: Peek slides it up until only the sliver shows. */
export const targetOffsetY = (state: ShellState, input: GeometryInput): number =>
  state === 'peek' ? -(input.layout.stripHeight - shellSizes.peekHeight) : 0;

/** Whether `state` shows the panel (as opposed to the strip in one of its forms). */
export const showsPanel = (state: ShellState): boolean =>
  state === 'expanded' || state === 'pinned';
