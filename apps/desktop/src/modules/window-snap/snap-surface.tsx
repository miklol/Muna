import { commands, defaultWindowSnapSettings, readWindowSnapSettings } from '@muna/contracts';
import { Text } from '@muna/ui/primitives';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSettings } from '../../lib/settings';
import { currentWindowLabel } from '../../lib/window-label';
import type { SnapSurfaceProps } from '../registry';
import { ZoneGlyph } from './zone-glyph';
import { measureTiles, snapTiles, tileAt } from './zones';
import './snap-surface.css';

const ignoreRefusal = () => {
  // Rust logs the refusal (an elevated window, a zone the settings no longer offer).
};

/**
 * The zones a dragged window can be released on (docs/modules/window-snap.md; motion spec
 * "Window snap"): one row of layout glyph tiles, the one under the cursor tinted. The cursor
 * holds another window, so `:hover` never fires: the tile under `position` is found from the
 * DOM on every move. When the drag `ended` over this window the hovered tile is applied — Rust
 * places the window — or the session is cancelled; either way the notch is handed back.
 */
export function SnapSurface({ session, position, ended, maxWidth, onDone }: SnapSurfaceProps) {
  const { t } = useTranslation();
  const settings = useSettings();
  const snapSettings = useMemo(
    () => (settings === undefined ? defaultWindowSnapSettings() : readWindowSnapSettings(settings)),
    [settings],
  );
  const tiles = useMemo(() => snapTiles(snapSettings, t), [snapSettings, t]);

  const rootRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const handled = useRef(false);

  useLayoutEffect(() => {
    if (ended) {
      return;
    }
    setHovered(tileAt(measureTiles(rootRef.current), position));
  }, [ended, position, tiles]);

  useEffect(() => {
    if (!ended || handled.current) {
      return;
    }
    handled.current = true;
    const key = tileAt(measureTiles(rootRef.current), position);
    const tile = tiles.find((candidate) => candidate.key === key);
    if (tile === undefined) {
      commands.snapCancel(session).then(ignoreRefusal, ignoreRefusal);
    } else {
      setHovered(tile.key);
      commands
        .snapApply(session, currentWindowLabel(), tile.ref)
        .then(ignoreRefusal, ignoreRefusal);
    }
    onDone();
  }, [ended, onDone, position, session, tiles]);

  return (
    <div
      ref={rootRef}
      className="snap-surface"
      role="group"
      aria-label={t('windowSnap.zones')}
      data-testid="snap-surface"
      style={{ maxWidth, gridTemplateColumns: `repeat(${String(tiles.length)}, minmax(0, 1fr))` }}
    >
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className="snap-tile"
          data-tile-key={tile.key}
          data-hovered={hovered === tile.key ? '' : undefined}
          aria-label={tile.label}
        >
          <span className="snap-tile__glyph">
            <ZoneGlyph rect={tile.glyph} />
          </span>
          <Text variant="footnote" tone="secondary" truncate={1} className="snap-tile__title">
            {tile.label}
          </Text>
        </div>
      ))}
    </div>
  );
}
