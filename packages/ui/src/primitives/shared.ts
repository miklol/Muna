/**
 * Semantic accent tints (docs/05-design-system.md#colour): media = cyan, focus/pomodoro =
 * orange, health = green/blue/purple rings, danger = red. `accent` follows the user's choice.
 */
import type { CSSProperties } from 'react';

export type Tint =
  'accent' | 'blue' | 'cyan' | 'green' | 'orange' | 'red' | 'purple' | 'yellow' | 'pink';

/** The token behind a tint, for `--muna-tint` on tinted primitives. */
export const tintVar = (tint: Tint): string =>
  tint === 'accent' ? 'var(--accent)' : `var(--accent-${tint})`;

/** Inline style carrying the tint custom property (React's CSSProperties has no index signature). */
export const tintStyle = (tint: Tint, extra?: CSSProperties): CSSProperties =>
  ({ ...extra, '--muna-tint': tintVar(tint) }) as CSSProperties;

/** Joins class names, skipping falsy entries. */
export const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');
