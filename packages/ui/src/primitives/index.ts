/**
 * Primitives (docs/05-design-system.md#components), built on React Aria Components. Every
 * primitive ships a Storybook story and a Vitest render test. M0-E4 landed the seven the shell
 * needs first; M1-E4 added the panel chrome, the module bar and the shared controls; M1-E2 the
 * strip's slot renderers; M1-E3 the search field; M1-E5 the option tiles.
 */
export { BatteryGlyph, type BatteryGlyphProps, batteryLevels, batteryTint } from './battery-glyph';
export { Button, type ButtonProps, type ButtonVariant } from './button';
export { Card, type CardProps } from './card';
export { Chip, type ChipProps, type SelectableChipProps, type StaticChipProps } from './chip';
export { EmptyState, type EmptyStateProps } from './empty-state';
export { ErrorState, type ErrorStateProps } from './error-state';
export { Hairline, type HairlineProps } from './hairline';
export { IconButton, type IconButtonProps } from './icon-button';
export {
  ListRow,
  type ListRowProps,
  type PressableListRowProps,
  type StaticListRowProps,
} from './list-row';
export {
  ModuleBar,
  type ModuleBarItem,
  type ModuleBarPage,
  type ModuleBarProps,
  moduleBarCapacity,
  moduleBarLayout,
  moduleBarPage,
} from './module-bar';
export {
  notchMorphRadiusVar,
  NotchSurface,
  type NotchShape,
  type NotchState,
  type NotchSurfaceProps,
} from './notch-surface';
export { type OptionTileItem, OptionTiles, type OptionTilesProps } from './option-tiles';
export { PanelChrome, type PanelChromeProps } from './panel-chrome';
export { ProgressTrack, type ProgressTrackProps } from './progress-track';
export { Ring, type RingProps } from './ring';
export { SearchField, type SearchFieldProps } from './search-field';
export {
  SegmentedControl,
  type SegmentedControlItem,
  type SegmentedControlProps,
} from './segmented-control';
export { type Tint, tintVar } from './shared';
export { Skeleton, type SkeletonProps } from './skeleton';
export { Slider, type SliderProps } from './slider';
export {
  type StripSlotContent,
  StripView,
  type StripViewProps,
  stripSlotLayout,
  stripSlotOffsetPx,
} from './strip-view';
export { Text, type TextProps, type TextTone, type TextVariant } from './text';
export { formatCountdown, remainingNow, TimerText, type TimerTextProps } from './timer-text';
export { Toggle, type ToggleProps } from './toggle';
