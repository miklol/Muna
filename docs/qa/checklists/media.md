# QA checklist · Media now-playing

Covers the M2 exit criterion "correct now-playing within 300 ms of change" for the media
backend (docs/modules/media.md). Scoring across apps is covered by `tests/media.rs` (30-switch
script, 0 wrong picks); this checklist is the hardware side.

## Running it

1. Start Muna (`scripts\dev.ps1`) and a media app with a session (Spotify, Media Player, Edge).
2. `pwsh -NoProfile -File scripts\qa\media-latency.ps1` — it presses the keyboard's media keys
   (play/pause six times, next twice) and reads the `unix_ms` stamp the media module writes on
   its `now playing changed` log line, so each number is key press → strip activity published.
   Expect a few seconds of audio; playback ends where it started.
3. Paste the table below. Media keys go to the OS's current session, so only one app should be
   playing while it runs.

## Scenarios

| # | Scenario | Budget | How |
| --- | ---------- | -------- | ----- |
| 1 | Play from paused | < 300 ms | `VK_MEDIA_PLAY_PAUSE` |
| 2 | Pause from playing | < 300 ms | `VK_MEDIA_PLAY_PAUSE` |
| 3 | Track change: title and artist | < 300 ms | `VK_MEDIA_NEXT_TRACK`, first log line |
| 4 | Track change: artwork | recorded, no budget (apps deliver art late) | second log line, `art_version` bumped |
| 5 | Second app starts playing → follows the OS's current session | < 300 ms | manual: start playback in a second app |
| 6 | Pinned app stays while another plays | — | needs the Media pane (M2-E2) |

## Results

Win11 25H2, Spotify 1.2.x (desktop), 2026-09-16, first run of the harness:

| Result | Step | App | Status | Latency |
| -------- | ------ | ----- | -------- | --------- |
| FAIL | play/pause 1 | Spotify.exe | Playing | 372 ms (first press after launch) |
| PASS | play/pause 2 | Spotify.exe | Paused | 275 ms |
| PASS | play/pause 3 | Spotify.exe | Playing | 23 ms |
| PASS | play/pause 4 | Spotify.exe | Paused | 291 ms |
| PASS | play/pause 5 | Spotify.exe | Playing | 19 ms |
| PASS | play/pause 6 | Spotify.exe | Paused | 292 ms |
| PASS | next 1 (track) | Spotify.exe | Playing | 71 ms |
| SKIP | next 1 (art v2) | Spotify.exe | Playing | 2110 ms |
| PASS | next 2 (track) | Spotify.exe | Playing | 86 ms |
| SKIP | next 2 (art v4) | Spotify.exe | Playing | 820 ms |

Median play/pause 275 ms, max 372 ms. Every pause sits at 275–292 ms while every play is
≈ 20 ms: Spotify fades its audio out before it reports `Paused` to the OS, so the figure is the
app's, not the module's (the same key path delivers `Playing` in 20 ms). The one miss is the
first press after the app started. Artwork trails the track change by 0.8–2.1 s, which the
module hides by holding the previous picture. The strip showed the artwork and the wide form
("Title · Artist") on each skip.

## Still to run (maintainer)

- Scenario 5 with Edge/YouTube, Apple Music (Store) and foobar2000, and the two-app switch
  (this machine's `.wav` association is broken and Edge did not publish a session for a local
  file, so no second app was available to the harness).
- Win10 22H2 column.

## Harness notes

- The log's own clock is 1 s; the module stamps `unix_ms` on the `now playing changed` line for
  this purpose. The line carries the app id, status, session count and `art_version` only —
  never a title.
- `keybd_event` media keys are delivered through the OS's media session manager exactly like a
  keyboard's, so the measurement includes the OS and the app, not just Muna.
