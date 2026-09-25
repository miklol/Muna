# Media

**Tier P0 · Owner: `muna-module-developer` · Status: in progress (backend landed in M2-E1, UI in
M2-E2)**

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

## Implementation notes (M2-E2)

The UI landed in M2-E2: the strip form with waveform bars, the wide form marquee, the panel and
the Media settings pane. Visualiser capture, lyrics and output devices are still open (below).

**Where the code lives.**

- `packages/ui` primitives — `Waveform` (four `transform`-only bars, static under reduced
  motion), `Marquee` (measures overflow with `ResizeObserver`, scrolls only when the text does
  not fit) and `AlbumArt` (`data-dimmed` while paused, `data-tinted` bleed from the palette).
  `StripView` gained the waveform trailing slot and the `--muna-art-tint` halo. Every state has a
  story; `pnpm -w storybook:ci` covers them.
- `apps/desktop/src/modules/media` — `media-store.ts` (Zustand: state, art, palette),
  `use-media.ts` (subscribes to `MediaStateChanged` / `MediaArtChanged`, seeds from
  `get_media_snapshot`), `progress.ts` (position interpolation, `appDisplayName`), `panel.tsx`
  (panel body), `settings.tsx` (pane) and `index.ts` (the `ModuleDefinition`). The module reads
  and writes only its own settings namespace and talks to Rust through the generated bindings.
- `src-tauri/src/modules/media/settings.rs` — `MediaSettings` for the `settings.modules.media`
  namespace: `{ preferredApp: string | null, adaptiveColours: boolean, visualiser: "bars" |
  "off" }`. A missing or malformed entry yields the defaults, unknown keys are ignored, and
  `media_pin` writes `preferredApp` so a pin survives a relaunch. The tracker honours
  `visualiser: "off"` by dropping the trailing slot while playing (the paused glyph stays) and
  `adaptiveColours: false` by publishing artwork without a glow.

**Panel.** 96 px art with radius 12 (spec; the reference notes observed 72 px / 10 — see
deviations), title (`title3`), "Artist · Album" footnote, progress track, elapsed and remaining
time, transport row (shuffle · previous · play/pause 44 px filled · next · repeat) and, when more
than one app has a session, app chips ("Show Spotify", "Show Microsoft Edge", …) that pin
through `media_pin`. Apps whose
session reports `controls.seek: false` get a non-interactive `ProgressTrack`, never a fake
slider. The position advances locally once a second while `Playing` and freezes on `Paused`.
`appDisplayName` shortens `AppUserModelId`s (`Spotify.exe` → Spotify) and maps the common
browsers and players (`MSEdge` → Microsoft Edge, `ZuneMusic` → Media Player, …).

**Palette bleed.** The art's `data-tinted` bleed is two static `box-shadow`s, not a gradient:
`radial-gradient(color-mix(in oklab, transparent, <accent> …))` rendered as an ordered dither
(alternating pure-black and near-black pixels) over the black glass in WebView2. Measured on a
55 × 81 px band beside the art: 62 pure-black speckles with `color-mix(… transparent …)`, 0 with
`rgb(from var(--media-accent-1) r g b / 0.3)`. The same relative-colour syntax is used for the
strip halo. `prefers-contrast: more` removes both.

**Measured** (Win11 25H2, 2560 × 1600 at 150 %, Spotify 1.2.x, `scripts/dev.ps1`): the
panel's art measures 144 physical px (96 CSS px); the strip window is 1120 × 480 CSS px. Spotify
publishes `controls.seek: false`, so its progress is a track; a cached palette for one track came
out `#87703a, #476caa, #a2bbc9` and the panel's bleed followed a Spotify ad's yellow artwork.
Pause via the media key dimmed the art, swapped in the play glyph and froze the elapsed time
(0:40 / 3:14) while the bleed stayed. The module bar paints `--surface-2` over `--notch-black`
itself, because the window behind it is transparent (it read as see-through over a light
wallpaper before).

**Observed, not a regression.** With the desktop focused, Explorer's
`XamlExplorerHostIslandWindow` (a borderless `WS_POPUP` covering the monitor) trips the
fullscreen heuristic and parks the notch; clicking any captioned window brings it back.
Excluding Explorer's shell-host classes from `is_fullscreen` is a shell follow-up.

**Deviations from the spec, deferred:**

- Art is 96 px / radius 12 per this document; `docs/reference/ui-observations.md` records the
  macOS reference at 72 px / 10. Revisit with the design review.
- Visualiser styles are `bars` / `off` only; `spectrum` needs the WASAPI loopback capture
  (M2-E3 or later), as do the volume slider and the output-device popover.
- Lyrics drawer, hover-reveal transport on the strip, per-app strip filters and settings-search
  indexing of the Media pane are not built.
- The bleed is static shadows rather than a blurred copy of the art (see the dither finding).
