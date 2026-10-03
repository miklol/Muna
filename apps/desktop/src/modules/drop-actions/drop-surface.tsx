import {
  commands,
  defaultDropActionsSettings,
  dropTilesPerRow,
  readDropActionsSettings,
} from '@muna/contracts';
import {
  reducedMotionTransition,
  springs,
  staggerDelayS,
  tileStaggerRecipe,
  useReduceMotion,
} from '@muna/ui/motion';
import { Text } from '@muna/ui/primitives';
import { motion, type Transition } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSettings } from '../../lib/settings';
import type { DropSurfaceProps } from '../registry';
import { TileGlyph } from './tile-icon';
import {
  type ActionTile,
  MORE_KEY,
  rowColumns,
  rowLayout,
  runnableTile,
  tileAt,
  tileEntries,
  type TileRect,
} from './tiles';
import './drop-surface.css';

const ignoreRefusal = () => {
  // Rust logs the refusal; the strip's `dropFailed` notice tells the user.
};

/** Every tile's box in client px — the space the drag's `position` is reported in. */
export const measureTiles = (root: HTMLElement | null): TileRect[] => {
  if (root === null) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>('[data-tile-key]')).map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      key: node.getAttribute('data-tile-key') ?? '',
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
};

/**
 * The tile row files are dropped on (docs/modules/drop-actions.md; motion spec "Drop
 * actions"): the tiles stagger in, the one under the drag grows and tints, the *More* tile
 * reveals the rows past the first, and the target pulses once on release before the row
 * collapses. The pointer is an OLE drag, so `:hover` never fires: the tile under `position`
 * is found from the DOM on every move.
 */
export function DropSurface({
  session,
  items,
  position,
  dropped,
  maxWidth,
  onDone,
}: DropSurfaceProps) {
  const { t } = useTranslation();
  const settings = useSettings();
  const reduceMotion = useReduceMotion();
  const dropSettings = useMemo(
    () =>
      settings === undefined ? defaultDropActionsSettings() : readDropActionsSettings(settings),
    [settings],
  );
  const disabledModules = settings?.shell.disabledModules;
  const entries = useMemo(
    () => tileEntries(dropSettings, items, t, disabledModules),
    [disabledModules, dropSettings, items, t],
  );
  const [revealed, setRevealed] = useState(false);
  const layout = useMemo(
    () => rowLayout(entries, dropTilesPerRow(dropSettings), revealed, t),
    [dropSettings, entries, revealed, t],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pulsing, setPulsing] = useState<string | null>(null);
  const handled = useRef(false);

  useLayoutEffect(() => {
    if (dropped) {
      return;
    }
    const key = tileAt(measureTiles(rootRef.current), position);
    setHovered(key);
    if (key === MORE_KEY) {
      setRevealed(true);
    }
  }, [dropped, layout, position]);

  // Release: the tile under the drop runs; nothing (or a dimmed tile) cancels. Either way the
  // row hands the notch back — after one pulse of the target unless motion is reduced.
  useEffect(() => {
    if (!dropped || handled.current) {
      return;
    }
    handled.current = true;
    const tile = runnableTile(layout, tileAt(measureTiles(rootRef.current), position));
    if (tile === null) {
      commands.dropCancel(session).then(ignoreRefusal, ignoreRefusal);
      onDone();
      return;
    }
    commands.dropRun(session, tile.action).then(ignoreRefusal, ignoreRefusal);
    if (reduceMotion) {
      onDone();
      return;
    }
    setHovered(tile.key);
    setPulsing(tile.key);
  }, [dropped, layout, onDone, position, reduceMotion, session]);

  const enterTransition = (index: number): Transition =>
    reduceMotion ? reducedMotionTransition : { ...springs.expand, delay: staggerDelayS(index) };

  return (
    <div
      ref={rootRef}
      className="drop-surface"
      role="group"
      aria-label={t('dropActions.row', { count: items.length })}
      data-testid="drop-surface"
      style={{ maxWidth }}
    >
      {layout.rows.map((row) => {
        let tileIndex = -1;
        return (
          <div
            key={row.map((entry) => entry.key).join('|')}
            className="drop-row"
            style={{ gridTemplateColumns: rowColumns(row) }}
          >
            {row.map((entry) => {
              if (entry.kind === 'divider') {
                return <div key={entry.key} className="drop-divider" role="separator" />;
              }
              tileIndex += 1;
              return (
                <motion.div
                  key={entry.key}
                  className="drop-tile-slot"
                  initial={
                    reduceMotion ? tileStaggerRecipe.reducedEnterFrom : tileStaggerRecipe.enterFrom
                  }
                  animate={
                    reduceMotion ? tileStaggerRecipe.reducedVisible : tileStaggerRecipe.visible
                  }
                  transition={enterTransition(tileIndex)}
                >
                  <Tile
                    tile={entry}
                    hovered={hovered === entry.key}
                    pulsing={pulsing === entry.key}
                    reduceMotion={reduceMotion}
                    onPulsed={onDone}
                  />
                </motion.div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

interface TileProps {
  readonly tile: ActionTile;
  readonly hovered: boolean;
  readonly pulsing: boolean;
  readonly reduceMotion: boolean;
  readonly onPulsed: () => void;
}

/** Hover grows the tile 1.04 with `toggle`; the drop target pulses 1.06 → 1 with `notice`. */
function Tile({ tile, hovered, pulsing, reduceMotion, onPulsed }: TileProps) {
  const highlighted = hovered && tile.enabled;
  const scale = pulsing ? [1.06, 1] : highlighted ? 1.04 : 1;
  const transition: Transition = reduceMotion
    ? reducedMotionTransition
    : pulsing
      ? springs.notice
      : springs.toggle;
  const pulseProps = pulsing ? { onAnimationComplete: onPulsed } : {};
  return (
    <motion.div
      className="drop-tile"
      data-tile-key={tile.key}
      data-hovered={highlighted ? '' : undefined}
      aria-disabled={tile.enabled ? undefined : true}
      animate={{ scale }}
      transition={transition}
      {...pulseProps}
    >
      <span className="drop-tile__glyph">
        <TileGlyph icon={tile.icon} />
      </span>
      <Text variant="callout" truncate={1} className="drop-tile__title">
        {tile.title}
      </Text>
      <Text variant="footnote" tone="secondary" truncate={1} className="drop-tile__subtitle">
        {tile.subtitle}
      </Text>
    </motion.div>
  );
}
