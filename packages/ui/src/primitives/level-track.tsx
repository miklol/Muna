import './level-track.css';
import { cx } from './shared';
import { Slider } from './slider';
import { Text } from './text';

export interface LevelTrackProps {
  /** Names the control: "Volume" or "Brightness". */
  'aria-label': string;
  /** 0–100. */
  percent: number;
  /** Muted output: the fill drains while the value stays (docs/06-motion-spec.md "HUD"). */
  muted?: boolean;
  /**
   * The value beside the track, already formatted for the locale ("45%"); `null` hides it
   * (the HUD's *Show level text* setting).
   */
  valueText?: string | null;
  /** Live drag / key step; the HUD forwards it to the platform. */
  onChange?: ((percent: number) => void) | undefined;
  /** Pointer or key released. */
  onChangeEnd?: ((percent: number) => void) | undefined;
  className?: string;
}

/**
 * The HUD level (docs/05-design-system.md "Per-surface notes": 96 × 6 track, value optional as
 * `--text-caption` tabular): the plain-fill `Slider` with the percentage beside it. Draggable
 * while it shows; the `StripView` slot it lives in decides when it appears and leaves.
 */
export function LevelTrack({
  'aria-label': label,
  percent,
  muted = false,
  valueText = null,
  onChange,
  onChangeEnd,
  className,
}: LevelTrackProps) {
  return (
    <span className={cx('muna-level-track', className)} data-muted={muted || undefined}>
      <Slider
        aria-label={label}
        fill="plain"
        muted={muted}
        value={percent}
        minValue={0}
        maxValue={100}
        step={1}
        {...(onChange === undefined ? {} : { onChange })}
        {...(onChangeEnd === undefined ? {} : { onChangeEnd })}
        className="muna-level-track__slider"
      />
      {valueText !== null && (
        <Text
          as="span"
          variant="caption"
          tabular
          aria-hidden="true"
          className="muna-level-track__value"
        >
          {valueText}
        </Text>
      )}
    </span>
  );
}
