# Media

**Tier P0 · Owner: `muna-module-developer` · Status: spec**

## Purpose

Now-playing artwork, transport, progress, visualiser, lyrics and output device — for any app
that reports to Windows' System Media Transport Controls (SMTC): Spotify, Apple Music for
Windows, Edge/Chrome/Firefox (YouTube, YT Music, SoundCloud…), VLC, Groove/Media Player, MPC,
foobar2000 (plugin), Tidal, Deezer, Amazon Music, iTunes.

## Reference

`media-feature`, `media-feature-2…5`, `demo-02`. Panel: 72 px art + title/artist · progress ·
transport row (shuffle ⏮ ⏸ ⏭ repeat output) · Lyrics column. Strip: art + visualiser bars;
hover-reveal: title + ⏮ ⏸ ⏭. Dashboard: media card.

## Data & platform

- **Sessions**: `GlobalSystemMediaTransportControlsSessionManager.RequestAsync()`; subscribe
  to `SessionsChanged`, `CurrentSessionChanged`, per-session `MediaPropertiesChanged`,
  `PlaybackInfoChanged`, `TimelinePropertiesChanged`. Expose all sessions; default to
  `GetCurrentSession()`; user can pin an app.
- **Metadata**: title, artist, album, `Thumbnail` (`IRandomAccessStreamReference` → PNG/JPEG
  bytes → base64 to UI, cached by hash). Spotify thumbnails arrive ~300–1000 ms after the
  track changes — keep the previous art until the new one lands (no flash).
- **Timeline**: SMTC timeline updates are coarse (≈ 1–5 s) for some apps; UI interpolates
  locally from `Position` + `LastUpdatedTime` while `Playing`.
- **Controls**: `TryPlayAsync/TryPauseAsync/TrySkipNext/TrySkipPrevious/TryChangeShuffle/
  TryChangeAutoRepeatMode/TryChangePlaybackPositionAsync` (seek support varies by app).
- **Visualiser**: WASAPI loopback capture (`IAudioClient` `AUDCLNT_STREAMFLAGS_LOOPBACK`) of
  the default render device → 32-band FFT in Rust → 12 bar magnitudes at 30 Hz to UI. Off when
  paused/hidden. Alternative "fake" animation when capture is denied.
- **Adaptive colours**: k-means/median-cut on the artwork (Rust) → 3 swatches → UI gradient
  tokens (`--media-accent-1..3`), also drives strip accent for the wide form.
- **Output device**: enumerate render endpoints (`IMMDeviceEnumerator`), volume per endpoint,
  set default via `IPolicyConfig` (undocumented but ubiquitous; behind a feature flag).
- **Lyrics** (optional): LRCLIB (free, no key) by title/artist/duration; synced lines when
  available; Spotify Web API optional for like/queue (PKCE OAuth).
- **Fallback when no SMTC session**: module shows "Nothing playing" with last app icon.

## States

| State | Strip | Panel |
|-------|-------|-------|
| Playing | art + bars | full |
| Paused | art (dimmed) + ▶ glyph | full, play button prominent |
| Track change | wide form 2.5 s | art crossfade + gradient morph |
| No session | hidden from strip | "Nothing playing" empty state |
| Ad / unknown metadata | generic icon | title fallback |

## Settings (pane: Media)

Preferred app / auto; hover-reveal transport; visualiser style (bars / spectrum / off); adaptive
colours; show lyrics; per-app filters for the strip; output-device switching (flag).

## Acceptance criteria

- Given Spotify starts playing, then art, title and artist appear in the panel within 500 ms
  of `MediaPropertiesChanged` and the strip shows bars.
- Given YouTube in Edge plays then Spotify plays, then the current session follows the OS's
  current session unless pinned.
- Given seek is unsupported by the app, then the progress bar is non-interactive (no fake seek).
- Given the panel is collapsed and media paused, then no loopback capture or FFT runs.

## Perf budget

FFT + colour extraction in Rust ≤ 1 % CPU while playing; artwork ≤ 512 px cached.
