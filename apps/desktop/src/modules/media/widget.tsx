import { commands, type MediaCommand } from '@muna/contracts';
import { AlbumArt, IconButton, Text } from '@muna/ui';
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { useMediaStore } from './media-store';
import './media.css';
import { appDisplayName, artistLine, displayTitle } from './progress';
import { useMediaSubscription } from './use-media';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** Art is 56 px on a wide card and 40 px on a narrow one (`AlbumArt`: "cards 40"). */
export const WIDGET_ART = { 1: 40, 2: 56 } as const;

/**
 * The media card on the dashboard (docs/modules/dashboard.md "Widgets": Media card): the art,
 * the title and the artist; a wide card adds previous, play/pause and next. "Nothing playing"
 * while there is no session. Subscribes like the panel and unlistens on unmount.
 */
export function MediaWidget({ span }: WidgetProps) {
  const { t } = useTranslation();
  useMediaSubscription();
  const state = useMediaStore((store) => store.state);
  const art = useMediaStore((store) => store.art);
  const active = state?.active ?? null;

  const send = useCallback(
    (command: MediaCommand) => {
      void commands.mediaCommand(active?.sourceAppId ?? null, command).catch(() => {
        // The app refused or vanished; the next MediaStateChanged shows what is true.
      });
    },
    [active?.sourceAppId],
  );

  if (active === null) {
    return (
      <div className="media-widget" data-empty>
        <AlbumArt
          src={null}
          size={WIDGET_ART[span]}
          adaptive={false}
          fallback={<Music strokeWidth={ICON_STROKE} />}
        />
        <Text as="p" variant="footnote" tone="secondary" className="media-widget__empty">
          {t('media.empty.title')}
        </Text>
      </div>
    );
  }

  const playing = active.status === 'playing';
  const currentArt = art !== null && art.key === state?.artKey ? art : null;
  return (
    <div className="media-widget" data-status={active.status}>
      <AlbumArt
        src={currentArt?.src ?? null}
        palette={currentArt?.palette ?? []}
        adaptive={false}
        dimmed={!playing}
        size={WIDGET_ART[span]}
        fallback={<Music strokeWidth={ICON_STROKE} />}
      />
      <div className="media-widget__text">
        <Text as="span" variant="footnote" weight={600} truncate={1}>
          {displayTitle(active.title, t('media.unknownTitle'))}
        </Text>
        <Text as="span" variant="caption" tone="secondary" truncate={1}>
          {artistLine(active.artist, active.album) || appDisplayName(active.sourceAppId)}
        </Text>
      </div>
      {span === 2 && (
        <div className="media-widget__transport" role="group" aria-label={t('media.transport')}>
          <IconButton
            aria-label={t('media.previous')}
            isDisabled={!active.controls.previous}
            onPress={() => {
              send({ kind: 'previous' });
            }}
          >
            <SkipBack strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton
            aria-label={t(playing ? 'media.pause' : 'media.play')}
            isDisabled={playing ? !active.controls.pause : !active.controls.play}
            onPress={() => {
              send({ kind: playing ? 'pause' : 'play' });
            }}
          >
            {playing ? (
              <Pause strokeWidth={ICON_STROKE} fill="currentColor" />
            ) : (
              <Play strokeWidth={ICON_STROKE} fill="currentColor" />
            )}
          </IconButton>
          <IconButton
            aria-label={t('media.next')}
            isDisabled={!active.controls.next}
            onPress={() => {
              send({ kind: 'next' });
            }}
          >
            <SkipForward strokeWidth={ICON_STROKE} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
