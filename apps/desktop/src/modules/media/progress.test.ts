import { describe, expect, it } from 'vitest';

import {
  appDisplayName,
  artistLine,
  displayTitle,
  formatTime,
  hasTimeline,
  positionNow,
  scrubToMs,
} from './progress';

describe('media progress math', () => {
  it('advances the position by the snapshot age only while playing', () => {
    expect(positionNow(10_000, 200_000, 'playing', 1_000, 6_000)).toBe(15_000);
    expect(positionNow(10_000, 200_000, 'paused', 1_000, 6_000)).toBe(10_000);
    expect(positionNow(10_000, 200_000, 'stopped', 1_000, 6_000)).toBe(10_000);
  });

  it('never runs past the end, below zero, or invents a position', () => {
    expect(positionNow(199_000, 200_000, 'playing', 0, 5_000)).toBe(200_000);
    expect(positionNow(-50, null, 'paused', 0, 0)).toBe(0);
    expect(positionNow(10_000, 200_000, 'playing', 5_000, 4_000)).toBe(10_000);
    expect(positionNow(null, 200_000, 'playing', 0, 5_000)).toBeNull();
    expect(positionNow(10_000, null, 'playing', 0, 5_000)).toBe(15_000);
  });

  it('formats times like the strip countdown', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(231_000)).toBe('3:51');
    expect(formatTime(3_600_000)).toBe('1:00:00');
  });

  it('turns a scrub fraction into a whole millisecond inside the track', () => {
    expect(scrubToMs(0.5, 200_000)).toBe(100_000);
    expect(scrubToMs(1.2, 200_000)).toBe(200_000);
    expect(scrubToMs(-0.1, 200_000)).toBe(0);
    expect(scrubToMs(0.3333, 1_000)).toBe(333);
    expect(scrubToMs(0.5, -10)).toBe(0);
  });

  it('draws a timeline only for a known, positive duration', () => {
    expect(hasTimeline({ durationMs: 200_000 })).toBe(true);
    expect(hasTimeline({ durationMs: 0 })).toBe(false);
    expect(hasTimeline({ durationMs: null })).toBe(false);
  });

  it('falls back for ads and joins artist and album with a middle dot', () => {
    expect(displayTitle('Weird Fishes', 'Unknown title')).toBe('Weird Fishes');
    expect(displayTitle('  ', 'Unknown title')).toBe('Unknown title');
    expect(artistLine('Radiohead', 'In Rainbows')).toBe('Radiohead · In Rainbows');
    expect(artistLine('Radiohead', null)).toBe('Radiohead');
    expect(artistLine('', 'In Rainbows')).toBe('In Rainbows');
    expect(artistLine(' ', null)).toBe('');
  });

  it('shortens app user model ids to a name', () => {
    expect(appDisplayName('Spotify.exe')).toBe('Spotify');
    expect(appDisplayName('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify')).toBe('Spotify');
    expect(appDisplayName('Microsoft.ZuneMusic_8wekyb3d8bbwe')).toBe('Media Player');
    expect(appDisplayName('MSEdge')).toBe('Microsoft Edge');
    expect(appDisplayName('chrome')).toBe('Google Chrome');
    expect(appDisplayName('foobar2000')).toBe('foobar2000');
  });
});
