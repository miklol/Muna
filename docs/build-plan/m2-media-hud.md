# M2 · Media & HUD

Read `docs/07-roadmap.md#m2--media--hud-3-weeks`. Requires M1 merged.

---

## M2-E1 · Media backend — agent: `muna-module-developer`

**Progress:** landed (see [media → Implementation notes (M2-E1)](../modules/media.md#implementation-notes-m2-e1)).
WASAPI verification, visualiser, lyrics, volume/devices and the persisted preferred app moved to
E2/E3 as recorded there; the reducer lives in `src-tauri/src/modules/media/` rather than
`muna-core::media` because session types belong to `muna-platform`, which core may not import.

```text
Implement the Rust side of docs/modules/media.md. Read docs/04-windows-platform-apis.md#media
carefully (staleness, session scoring, WASAPI verification).

Scope in `muna-platform::media` + `muna-core::media`:
- GSMTC manager with re-RequestAsync every 60 s and on SessionsChanged; session scoring
  (Playing > Paused > most recently changed; WASAPI IAudioMeterInformation peak per session
  process as tie-breaker); events: NowPlayingChanged, PlaybackChanged, TimelineChanged.
- Thumbnail pipeline: stream → PNG bytes → cache by (title, artist, album) hash in
  %LOCALAPPDATA%\Muna\cache\art; palette (3 colours, k-means) computed in a blocking thread.
- Transport commands, shuffle/repeat, seek (TryChangePlaybackPositionAsync).
- Volume: IAudioEndpointVolume + callback; devices via IMMDeviceEnumerator; default-device
  switch through the isolated `undocumented::policy_config` module, executed via helper process
  when packaged (ADR-0003).
- Visualizer: WASAPI loopback + realfft, 20 bands at 30 Hz, only while `visible` flag set.
- Lyrics: LRCLIB client with SQLite cache (optional feature flag).
- Tests with FakePlatform: scoring, staleness recovery, palette determinism, cache eviction.
```

## M2-E2 · Media UI — agent: `muna-ui-engineer`

**Progress:** landed (see [media → Implementation notes (M2-E2)](../modules/media.md#implementation-notes-m2-e2)).
Strip waveform, wide-form marquee, panel, app pinning and the Media pane shipped; the volume
slider, output-device popover, lyrics drawer and `spectrum` visualiser wait for the WASAPI work
recorded there. The palette bleed is two `box-shadow`s rather than a gradient because
`color-mix(… transparent …)` dithers over the black glass (measured, same notes).

```text
Implement the media surfaces from docs/modules/media.md using the reference layout in
docs/reference/ui-observations.md (media panel). Read docs/06-motion-spec.md (track-change
choreography, waveform).

Scope: strip form (art 20 px + 4-bar waveform, palette-tinted glow), wide form on track change
(title/artist marquee only if overflow), panel: art 96 px with palette gradient bleed, title/
artist/album, progress with scrubbing, transport (prev/play/next 28 px), shuffle/repeat chips,
volume slider, output device popover, visualizer toggle, lyrics drawer. Empty state "Nothing
playing". Storybook stories for all states; Vitest for scrub math and marquee gating. Request
@muna-design-reviewer.
```

## M2-E3 · HUD — agent: `muna-shell-engineer`

**Progress:** landed in two PRs. PR A (backend) — Core Audio volume/mute and microphone mute,
WMI + DDC/CI brightness with the capability probe, flyout keeper and `--watchdog` process, the
`hud` module with its six commands and `HudStateChanged` event, glyph and `level` vocabulary in
the strip (see [hud → Implementation notes (M2-E3 PR A)](../modules/hud.md#implementation-notes-m2-e3-pr-a)).
The hold is the motion spec's 1.5 s; the module spec's earlier 1 200 ms was corrected. PR B
(strip UI) — `LevelTrack` primitive and `level` slot in `StripView`, glyph crossfade,
scroll-on-strip volume and track drag in the shell, the *Volume and brightness* settings pane,
and the manual checklist ([hud → Implementation notes (M2-E3 PR B)](../modules/hud.md#implementation-notes-m2-e3-pr-b),
[qa/checklists/hud](../qa/checklists/hud.md)). Deviations: glyph crossfade instead of a path
morph; brightness drag targets the single adjustable display; Win10 and external DDC/CI
unverified in the lab.

```text
Implement docs/modules/hud.md. Read docs/04-windows-platform-apis.md#hud-volume-brightness-
keyboard for the exact (undocumented) flyout suppression procedure and caveats.

Scope: HUD live-activity source (volume/mute/brightness) with the 1.5 s timing; brightness
backend (WMI internal + DDC/CI external with capability probe, opt-in per monitor); flyout
suppression in `platform::undocumented::flyout` (build-specific classes, explorer PID and
GetWindowBand checks, WinEvent re-hook, 3 s timer) with a watchdog process that restores the
flyout if Muna dies; scroll-on-strip volume; settings toggles. Tests: suppression state
machine with FakePlatform; manual checklist docs/qa/checklists/hud.md (Win10/Win11, kill -9
restore).
```

## M2-E4 · Performance harness — agent: `muna-qa-engineer`

**Progress:** `scripts/perf` landed as `report.mjs` (pure: budgets, plans, parsing, statistics,
markdown; unit-tested) + `probe.ps1` (Win32 helper) + `harness.mjs` (launch, idle window,
cursor-driven morphs) + `index.mjs` (`--smoke` / `--full` CLI the `ci.yml` and `nightly.yml`
jobs already call). The first real run found two idle bugs in the shell — `useShellReady`
re-arming on every layout event (a shell ↔ UI loop at half the refresh rate, 31 % of one core
idle) and a morph frame sampler that never stopped after a mid-morph park — and, once fixed,
a memory budget miss (126 MB debug / 118–123 MB release private working set against 120 MB),
answered by the shell's idle memory target
([notch-shell → Memory target](../modules/notch-shell.md#memory-target)). Measured on
Win11 25H2: idle CPU 0.003–0.014 % normalised (0.09–0.46 % of one core), cold start
520–870 ms (debug) / 595–650 ms (release), idle memory 17–31 MB after the trim. Deferred:
the bundled SMTC test player and the media-playing CPU window, 4K emulation, the `MUNA_FPS`
overlay, the automatic delta against `main`; the morph-driving part of `--full` and the
first-morph-after-trim frame rate need an unlocked desktop (maintainer checklist).

```text
Build scripts/perf per docs/09-testing-qa.md#performance-harness-scriptsperf and wire it to
a nightly workflow (.github/workflows/nightly.yml on windows-latest). Bundle a tiny test media
player (Rust binary using SystemMediaTransportControls) so SMTC tests run on CI runners.
Output perf.json + markdown summary; fail on budget breach; post trend comment on PRs labelled
`perf`. Add the fps overlay dev tool (`MUNA_FPS=1`) if not present.
```
