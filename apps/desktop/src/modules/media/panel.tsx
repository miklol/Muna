import {
  commands,
  defaultMediaSettings,
  type MediaCommand,
  type MediaSession,
  readMediaSettings,
  type RepeatMode,
} from '@muna/contracts';
import {
  AlbumArt,
  Chip,
  EmptyState,
  IconButton,
  Marquee,
  ProgressTrack,
  Slider,
  Text,
  timings,
} from '@muna/ui';
import { Music, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useSettings } from '../../lib/settings';
import { useMediaStore } from './media-store';
import './media.css';
import {
  appDisplayName,
  artistLine,
  displayTitle,
  formatTime,
  hasTimeline,
  positionNow,
} from './progress';
import { useMediaSubscription } from './use-media';

/** Lucide icons in the panel body use stroke 1.75 at 16 px (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The repeat cycle the chip steps through: off → whole list → one track → off. */
export const nextRepeat = (mode: RepeatMode | null): RepeatMode => {
  switch (mode) {
    case null:
    case 'none':
      return 'list';
    case 'list':
      return 'track';
    case 'track':
      return 'none';
  }
};

/** A paused session subscribes to nothing. */
const noop = (): void => undefined;

/**
 * The interpolated playback position, refreshed once a second while playing
 * (`timings.progressStepMs`) and only while the caller is mounted; paused sessions read the
 * snapshot as is and subscribe to nothing. The clock is an external store of whole seconds
 * since the snapshot arrived, so the value is stable between ticks.
 */
export function usePlaybackPosition(
  session: MediaSession | null,
  receivedAt: number,
  now: () => number = Date.now,
): number | null {
  const playing = session?.status === 'playing';
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (!playing) return noop;
      const id = window.setInterval(onTick, timings.progressStepMs);
      return () => {
        window.clearInterval(id);
      };
    },
    [playing],
  );
  const elapsedSeconds = useCallback(
    () => (playing ? Math.max(0, Math.floor((now() - receivedAt) / 1000)) : 0),
    [now, playing, receivedAt],
  );
  const elapsed = useSyncExternalStore(subscribe, elapsedSeconds, elapsedSeconds);
  if (session === null) return null;
  return positionNow(
    session.positionMs,
    session.durationMs,
    session.status,
    receivedAt,
    receivedAt + elapsed * 1000,
  );
}

interface TimelineProps {
  session: MediaSession;
  positionMs: number;
  onSeek: (positionMs: number) => void;
}

/**
 * Progress with times. A session that accepts seeking gets a slider the pointer and keyboard
 * can drag; one that does not gets a plain track — the UI never fakes a seek
 * (docs/modules/media.md "Controls").
 */
function Timeline({ session, positionMs, onSeek }: TimelineProps) {
  const { t } = useTranslation();
  const durationMs = session.durationMs ?? 0;
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? positionMs;
  return (
    <div className="media-timeline">
      {session.controls.seek ? (
        <Slider
          aria-label={t('media.position')}
          className="media-scrubber"
          tint="cyan"
          minValue={0}
          maxValue={durationMs}
          step={1000}
          value={shown}
          onChange={(value) => {
            setDragging(value);
          }}
          onChangeEnd={(value) => {
            setDragging(null);
            onSeek(value);
          }}
        />
      ) : (
        <ProgressTrack
          aria-label={t('media.position')}
          className="media-progress"
          tint="cyan"
          minValue={0}
          maxValue={durationMs}
          value={shown}
        />
      )}
      <div className="media-times">
        <Text as="span" variant="caption" tone="secondary" tabular>
          {formatTime(shown)}
        </Text>
        <Text as="span" variant="caption" tone="secondary" tabular>
          {formatTime(durationMs)}
        </Text>
      </div>
    </div>
  );
}

interface TransportProps {
  session: MediaSession;
  onCommand: (command: MediaCommand) => void;
}

/** Shuffle, previous, play/pause (36 px, filled), next, repeat; disabled per `controls`. */
function Transport({ session, onCommand }: TransportProps) {
  const { t } = useTranslation();
  const playing = session.status === 'playing';
  const { controls } = session;
  const repeatIcon =
    session.repeat === 'track' ? (
      <Repeat1 strokeWidth={ICON_STROKE} />
    ) : (
      <Repeat strokeWidth={ICON_STROKE} />
    );
  return (
    <div className="media-transport" role="group" aria-label={t('media.transport')}>
      <IconButton
        aria-label={t('media.shuffle')}
        aria-pressed={session.shuffle === true}
        isActive={session.shuffle === true}
        isDisabled={!controls.shuffle}
        onPress={() => {
          onCommand({ kind: 'setShuffle', enabled: session.shuffle !== true });
        }}
      >
        <Shuffle strokeWidth={ICON_STROKE} />
      </IconButton>
      <IconButton
        aria-label={t('media.previous')}
        isDisabled={!controls.previous}
        onPress={() => {
          onCommand({ kind: 'previous' });
        }}
      >
        <SkipBack strokeWidth={ICON_STROKE} />
      </IconButton>
      <IconButton
        aria-label={t(playing ? 'media.pause' : 'media.play')}
        size="large"
        className="media-play"
        isDisabled={playing ? !controls.pause : !controls.play}
        onPress={() => {
          onCommand({ kind: playing ? 'pause' : 'play' });
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
        isDisabled={!controls.next}
        onPress={() => {
          onCommand({ kind: 'next' });
        }}
      >
        <SkipForward strokeWidth={ICON_STROKE} />
      </IconButton>
      <IconButton
        aria-label={t(session.repeat === 'track' ? 'media.repeatOne' : 'media.repeat')}
        aria-pressed={session.repeat !== null && session.repeat !== 'none'}
        isActive={session.repeat !== null && session.repeat !== 'none'}
        isDisabled={!controls.repeat}
        onPress={() => {
          onCommand({ kind: 'setRepeat', mode: nextRepeat(session.repeat) });
        }}
      >
        {repeatIcon}
      </IconButton>
    </div>
  );
}

interface SourcesProps {
  sessions: readonly MediaSession[];
  active: MediaSession | null;
  pinned: string | null;
  onPin: (sourceAppId: string | null) => void;
}

/**
 * Which app the module follows. One chip per session, the shown one selected; selecting a chip
 * pins that app (and saves it as the preferred app), selecting it again lets the scoring
 * choose. Hidden with a single session — there is nothing to choose.
 */
function Sources({ sessions, active, pinned, onPin }: SourcesProps) {
  const { t } = useTranslation();
  if (sessions.length < 2) return null;
  return (
    <div className="media-sources" role="group" aria-label={t('media.apps')}>
      {sessions.map((session) => {
        const shown = session.sourceAppId === active?.sourceAppId;
        const name = appDisplayName(session.sourceAppId);
        return (
          <Chip
            key={session.sourceAppId}
            aria-label={t('media.showApp', { app: name })}
            isSelected={shown}
            onChange={(selected) => {
              onPin(selected || pinned !== session.sourceAppId ? session.sourceAppId : null);
            }}
          >
            {name}
          </Chip>
        );
      })}
    </div>
  );
}

/**
 * The media panel (docs/modules/media.md, docs/reference/ui-observations.md "Media"): art 96
 * with the palette bled behind it, title (marquee only if it overflows), artist · album,
 * progress with scrubbing where the app allows it, transport, and the app picker when more
 * than one session exists. "Nothing playing" while there is no session.
 */
export function MediaPanel() {
  const { t } = useTranslation();
  useMediaSubscription();
  const state = useMediaStore((store) => store.state);
  const receivedAt = useMediaStore((store) => store.receivedAt);
  const art = useMediaStore((store) => store.art);
  const settings = useSettings();
  const media = settings === undefined ? defaultMediaSettings() : readMediaSettings(settings);
  const active = state?.active ?? null;
  const positionMs = usePlaybackPosition(active, receivedAt);

  const send = useCallback(
    (command: MediaCommand) => {
      void commands.mediaCommand(active?.sourceAppId ?? null, command).catch(() => {
        // The app refused or vanished; the next MediaStateChanged shows what is true.
      });
    },
    [active?.sourceAppId],
  );
  const pin = useCallback((sourceAppId: string | null) => {
    void commands.mediaPin(sourceAppId).catch(() => {
      // Same: the state event is the source of truth.
    });
  }, []);

  if (active === null) {
    return (
      <EmptyState
        icon={<Music strokeWidth={ICON_STROKE} />}
        title={t('media.empty.title')}
        description={t('media.empty.body')}
      />
    );
  }

  const paused = active.status !== 'playing';
  const currentArt = art !== null && art.key === state?.artKey ? art : null;
  return (
    <div className="media-panel" data-status={active.status}>
      <AlbumArt
        src={currentArt?.src ?? null}
        palette={currentArt?.palette ?? []}
        adaptive={media.adaptiveColours}
        dimmed={paused}
        fallback={<Music strokeWidth={ICON_STROKE} />}
      />
      <div className="media-details">
        <div className="media-meta">
          <Text as="h2" variant="title3" className="media-title">
            <Marquee>{displayTitle(active.title, t('media.unknownTitle'))}</Marquee>
          </Text>
          <Text as="p" variant="footnote" tone="secondary" truncate={1}>
            {artistLine(active.artist, active.album)}
          </Text>
        </div>
        {hasTimeline(active) && positionMs !== null && (
          <Timeline
            session={active}
            positionMs={positionMs}
            onSeek={(target) => {
              send({ kind: 'seek', positionMs: target });
            }}
          />
        )}
        <div className="media-actions">
          <Transport session={active} onCommand={send} />
          <Sources
            sessions={state?.sessions ?? []}
            active={active}
            pinned={state?.pinned ?? null}
            onPin={pin}
          />
        </div>
      </div>
    </div>
  );
}
