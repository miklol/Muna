# Media

**Tier P0 · Owner: `muna-module-developer` · Status: in progress (backend landed in M2-E1)**

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
| ------- | ------- | ------- |
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

## Implementation notes (M2-E1)

The backend landed in M2-E1; the UI, visualiser, lyrics and output device follow in M2-E2/E3.

**Where the code lives.** Three layers, each testable without the one below it:

- `muna-platform::Media` — `sessions()`, `thumbnail(app)`, `send(app, command)`, `refresh()`;
  the `MediaSession` snapshot carries status, position (already advanced by its age while
  playing), duration, shuffle, repeat, the app's `controls`, `is_current` and an `art_version`
  that increments whenever the app's thumbnail bytes change (`0` while it has none). The
  Windows implementation (`windows/media.rs`) runs one worker thread that re-requests the
  manager on `SessionsChanged`, `CurrentSessionChanged`, `refresh()` and every 60 s; duplicate
  `AppUserModelId`s are keyed `App#2`. The fake scripts sessions and thumbnails per app.
- `muna-core::artwork` — OS-agnostic image work: `art_key(title, artist, album)`, `prepare`
  (decode, downscale past 512 px to PNG, otherwise pass the bytes through with their real MIME,
  three-swatch deterministic k-means palette) and `ArtCache` (`%LOCALAPPDATA%\Muna\cache\art\
  <key>.json`, oldest-first eviction, atomic writes). `muna-core` still knows nothing about
  `muna-platform` (crate boundary rule).
- `muna::modules::media` — `MediaTracker` (pure reducer: scoring, art bookkeeping, strip
  activity), `MediaService` (the shared object the backend feeds and the IPC commands drive)
  and `MediaModule` (event loop). `tests/media.rs` drives the service with `FakePlatform`.

**Scoring.** A pinned app wins while it has a session. Otherwise rank by status (Playing >
Paused > Stopped), then the OS's own current session, then the most recent *content* change
(title, artist, album or status — position ticks do not count), then the OS's list order. The
30-switch script in `tests/media.rs` picks the wrong app 0 times.

**Strip activity.** `media:now-playing`, priority 60 playing / 20 paused, retracted when the
session is stopped or gone. Leading: `Image` (artwork) or the `Music` glyph until art lands;
trailing: `Waveform { playing }` while playing (a static audio-lines glyph until E2 ships the
bars), the `Play` glyph while paused; wide: `NowPlaying { title, artist }` ("Title · Artist";
the UI never logs either).

**Artwork.** Fetched only when `art_version` changes, prepared off the async runtime, cached by
track. The previous picture stays across a track change until the new one arrives (no flash),
is cleared when the active app changes, and late art for a session that is no longer active is
dropped. 100 entries on disk (Spotify's pass-through PNGs measure 115–320 KB each).

**Commands.** `media_command(source_app_id?, command)` targets the active session by default.
After a send, if no snapshot for that app arrives within 2 s the module calls `refresh()` once
(one `tokio::sleep` per command, no periodic timer). `media_pin` and `media_refresh` complete
the surface; `get_media_snapshot` returns state + art for a window that just opened;
`MediaStateChanged` / `MediaArtChanged` keep it current.

**Measured** (Win11 25H2, Spotify 1.2.x, `scripts/qa/media-latency.ps1`, media key →
activity published): play 19–23 ms; pause 275–292 ms (Spotify reports the pause after its
fade-out; the first press after launch took 372 ms); track skip → title/artist 71–86 ms;
artwork for the new track 0.8–2.1 s after the skip (Spotify delivers it late; the previous art
holds meanwhile). Artwork arrives as 300 × 300 PNG and the palette comes out stable across
re-deliveries.

**Deviations from the spec, deferred:**

- WASAPI `IAudioMeterInformation` tie-break — needs an `AppUserModelId` → process map; the
  `is_current` + recency rule covered every switch in the script and on hardware. Revisit if a
  wrong pick is reproduced.
- Visualiser (WASAPI loopback + FFT), lyrics (LRCLIB), output-device switching (`IPolicyConfig`)
  and the `Audio` Windows implementation — M2-E2/E3.
- The preferred-app setting is in memory until the Media pane persists it (M2-E2).
- Timeline: the platform advances the position by its age; the UI-side 1 s interpolation lands
  with the panel.
