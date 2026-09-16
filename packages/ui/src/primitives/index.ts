/**
 * Primitives (docs/05-design-system.md#components), built on React Aria Components. Every
 * primitive ships a Storybook story and a Vitest render test. M0-E4 lands the seven the shell
 * needs first; the rest arrive with the surfaces that use them (M1+).
 */
export { Chip, type ChipProps, type SelectableChipProps, type StaticChipProps } from './chip';
export { Hairline, type HairlineProps } from './hairline';
export { IconButton, type IconButtonProps } from './icon-button';
export {
  notchMorphRadiusVar,
  NotchSurface,
  type NotchShape,
  type NotchState,
  type NotchSurfaceProps,
} from './notch-surface';
export { ProgressTrack, type ProgressTrackProps } from './progress-track';
export { Ring, type RingProps } from './ring';
export { type Tint, tintVar } from './shared';
export { Text, type TextProps, type TextTone, type TextVariant } from './text';
