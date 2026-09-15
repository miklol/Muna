import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { notchPath, notchRadii } from '../shape/notch-path';
import { squirclePath, supportsCornerShape } from '../shape/squircle';
import './notch-surface.css';
import { cx } from './shared';

export type NotchShape = 'notch' | 'island';
export type NotchState = 'collapsed' | 'expanded';

export interface NotchSurfaceProps extends ComponentPropsWithoutRef<'div'> {
  /** `notch` hugs the top edge and flares into it; `island` floats as a capsule. */
  shape: NotchShape;
  /** Picks the material (strip vs panel) and the notch radii. */
  state: NotchState;
  /**
   * True while the parent animates the size. Masks are then dropped and the shape runs on
   * plain `border-radius`; the continuous-corner mask is swapped back in at rest.
   */
  morphing?: boolean;
  children?: ReactNode;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** How the silhouette is produced at rest. */
type Mask =
  | { readonly kind: 'radius' }
  | { readonly kind: 'corner-shape' }
  | { readonly kind: 'clip'; readonly clip: string; readonly outline: string };

/** Radii the mask needs in px, read from the element so token changes are honoured. */
const readRadius = (element: HTMLElement, token: string, fallback: number): number => {
  const parsed = Number.parseFloat(getComputedStyle(element).getPropertyValue(token));
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Border-box size at rest. Measuring is paused while the parent morphs the node so a size
 * animation never re-renders the surface per frame; the observer reattaches (and fires once)
 * when the morph ends, which is exactly when the at-rest mask must be regenerated.
 */
const useMeasuredSize = (ref: RefObject<HTMLElement | null>, paused: boolean): Size | null => {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null || paused) return;
    if (typeof ResizeObserver === 'undefined') {
      setSize({ width: element.offsetWidth, height: element.offsetHeight });
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize[0];
      setSize(
        box !== undefined
          ? { width: box.inlineSize, height: box.blockSize }
          : { width: element.offsetWidth, height: element.offsetHeight },
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, paused]);
  return size;
};

/**
 * The shell's material and silhouette (docs/05-design-system.md#materials, #shape). The outer
 * node paints the shadow under the body; the inner node carries the material, clips content to
 * the shape and draws the hairline along the very same path. Sizing is the parent's job — set
 * `width`/`height` through `style` or let content size it; the notch's flares are included.
 */
export function NotchSurface({
  shape,
  state,
  morphing = false,
  className,
  style,
  children,
  ...rest
}: NotchSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useMeasuredSize(ref, morphing);
  const [radii, setRadii] = useState({ strip: 14, panel: 28, island: 32 });

  useEffect(() => {
    if (ref.current === null) return;
    setRadii({
      strip: readRadius(ref.current, '--radius-strip', 14),
      panel: readRadius(ref.current, '--radius-panel', 28),
      island: readRadius(ref.current, '--radius-island', 32),
    });
  }, []);

  const mask = useMemo<Mask>(() => {
    if (morphing || size === null || size.width <= 0 || size.height <= 0) {
      return { kind: 'radius' };
    }
    if (shape === 'notch') {
      const options = {
        width: Math.max(0, size.width - 2 * notchRadii[state].topRadius),
        height: size.height,
        topRadius: notchRadii[state].topRadius,
        bottomRadius: state === 'collapsed' ? radii.strip : radii.panel,
      };
      return {
        kind: 'clip',
        clip: notchPath(options),
        outline: notchPath(options, { closed: false }),
      };
    }
    if (supportsCornerShape()) return { kind: 'corner-shape' };
    const path = squirclePath({ ...size, radius: radii.island });
    return { kind: 'clip', clip: path, outline: path };
  }, [morphing, size, shape, state, radii]);

  const shapeStyle: CSSProperties | undefined =
    mask.kind === 'clip'
      ? { clipPath: `path("${mask.clip}")` }
      : mask.kind === 'corner-shape'
        ? ({ cornerShape: 'squircle' } as CSSProperties)
        : undefined;

  const flare = shape === 'notch' ? notchRadii[state].topRadius : 0;

  return (
    <div
      ref={ref}
      className={cx(
        'muna-notch-surface',
        `muna-notch-surface--${shape}`,
        `muna-notch-surface--${state}`,
        morphing && 'muna-notch-surface--morphing',
        mask.kind === 'clip' && 'muna-notch-surface--clipped',
        className,
      )}
      style={{ ...style, '--muna-notch-flare': `${flare}px` } as CSSProperties}
      {...rest}
    >
      <div aria-hidden="true" className="muna-notch-surface__shadow" />
      <div className="muna-notch-surface__shape" style={shapeStyle}>
        <div className="muna-notch-surface__content">{children}</div>
        {mask.kind === 'clip' && (
          <svg aria-hidden="true" className="muna-notch-surface__outline">
            <path d={mask.outline} />
          </svg>
        )}
      </div>
    </div>
  );
}
