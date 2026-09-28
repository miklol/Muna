import type { MediaSession, PlaybackStatus } from '@muna/contracts';
import { formatCountdown } from '@muna/ui/primitives';

/**
 * Where playback is right now: the position the snapshot carried, advanced by the time since
 * it arrived while playing, never past the end. Paused and stopped sessions hold still.
 */
export const positionNow = (
  positionMs: number | null,
  durationMs: number | null,
  status: PlaybackStatus,
  receivedAt: number,
  now: number,
): number | null => {
  if (positionMs === null) return null;
  const advanced = status === 'playing' ? positionMs + Math.max(0, now - receivedAt) : positionMs;
  const clamped = Math.max(0, advanced);
  return durationMs === null ? clamped : Math.min(clamped, durationMs);
};

/** `m:ss` (or `h:mm:ss`) for a position or duration; the same shape as the strip's countdown. */
export const formatTime = (ms: number): string => formatCountdown(ms);

/** A drag along the scrubber, as a fraction of the track, converted to a whole millisecond. */
export const scrubToMs = (fraction: number, durationMs: number): number =>
  Math.round(Math.min(1, Math.max(0, fraction)) * Math.max(0, durationMs));

/** Whether the timeline can be drawn at all: a known duration above zero. */
export const hasTimeline = (session: Pick<MediaSession, 'durationMs'>): boolean =>
  session.durationMs !== null && session.durationMs > 0;

/** Title fallback for ads and unknown metadata (docs/modules/media.md "States"). */
export const displayTitle = (title: string, fallback: string): string =>
  title.trim() === '' ? fallback : title;

/** "Artist · Album", or whichever of the two is known. */
export const artistLine = (artist: string, album: string | null): string =>
  [artist, album ?? '']
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' · ');

/** Product names for ids that do not read well on their own (browsers, Microsoft players). */
const knownAppNames: Readonly<Record<string, string>> = {
  msedge: 'Microsoft Edge',
  chrome: 'Google Chrome',
  firefox: 'Firefox',
  brave: 'Brave',
  vlc: 'VLC',
  zunemusic: 'Media Player',
  'media.player': 'Media Player',
  itunes: 'iTunes',
  amusic: 'Apple Music',
};

/**
 * A friendlier app name from an `AppUserModelId` (`Spotify.exe` → `Spotify`, `MSEdge` →
 * `Microsoft Edge`).
 */
export const appDisplayName = (sourceAppId: string): string => {
  const withoutSuffix = sourceAppId.replace(/\.exe$/i, '');
  // Packaged apps look like `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`: keep the last
  // segment after `!` when there is one, else the family name before `_`.
  const bang = withoutSuffix.lastIndexOf('!');
  const underscore = withoutSuffix.indexOf('_');
  const family = underscore === -1 ? withoutSuffix : withoutSuffix.slice(0, underscore);
  const dot = family.lastIndexOf('.');
  const short =
    bang !== -1 ? withoutSuffix.slice(bang + 1) : dot === -1 ? family : family.slice(dot + 1);
  return knownAppNames[short.toLowerCase()] ?? short;
};
