# Volume / brightness HUD

**Tier P0 · Owner: `muna-shell-engineer` · Status: backend shipped (M2-E3 PR A); strip UI in
PR B**

## Purpose

Replace Windows' volume/brightness flyout with a HUD inside the strip (MacNotch "Volume and
Brightness HUD"; Notch for Windows "Redesigned HUD").

## Data & platform

- **Volume**: `IAudioEndpointVolume::RegisterControlChangeNotify` on the default render
  endpoint; re-subscribe on `IMMNotificationClient::OnDefaultDeviceChanged`. Mute state
  included. Mic mute via the default capture endpoint (show mic glyph).
- **Brightness**: laptops via WMI `WmiMonitorBrightnessEvents` / `WmiMonitorBrightnessMethods`
  (`WmiSetBrightness`); external monitors via DDC/CI (`GetMonitorBrightness` /
  `SetMonitorBrightness` from `dxva2.dll`), per physical monitor, best effort.
- **Keys**: no hooking needed for volume — endpoint notifications fire for hardware keys.
  Brightness keys fire WMI events on most laptops; fallback `WH_KEYBOARD_LL` for
  `VK_VOLUME_*`/brightness scancodes when the OEM tool swallows events.
- **Suppress native flyout** *(undocumented, best effort)*: locate the shell OSD window pair
  by Windows build — ≥ 22620: `XamlExplorerHostIslandWindow` ⊃
  `Windows.UI.Composition.DesktopWindowContentBridge` (title `DesktopWindowXamlSource`);
  older: `NativeHWNDHost` ⊃ `DirectUIHWND` — and accept it only if it belongs to
  `explorer.exe` **and** `GetWindowBand(hwnd) == ZBID_ABOVELOCK_UX` (otherwise Alt-Tab can be
  grabbed). `ShowWindowAsync(inner, SW_MINIMIZE)` hides it; a keeper thread re-applies from
  `SetWinEventHook(EVENT_OBJECT_CREATE…EVENT_OBJECT_SHOW)` and `EVENT_SYSTEM_MINIMIZEEND` on
  explorer's PID, plus a 3 s re-check timer that also re-hooks after an explorer restart
  (ModernFlyouts `NativeFlyoutHandler` technique, written from its description). Restore on
  exit and via the watchdog on crash. Setting: *Replace system flyout* (default on). When no
  flyout window exists yet the state is *unavailable* and the hook catches the window the
  first time the shell creates it; nothing breaks.
- **Interaction**: HUD slider is draggable while shown; scroll wheel over the strip adjusts
  volume when the HUD is visible or when *Scroll on strip = volume* is on.

## Settings

`settings.modules.hud` (defaults in brackets):

| Key | Type | Meaning |
| ----- | ------ | --------- |
| `replaceSystemFlyout` | bool [`true`] | Hide the Windows flyout while Muna runs |
| `scrollOnStrip` | `"panel"` \| `"volume"` [`"panel"`] | What the wheel does over the collapsed strip |
| `showLevelText` | bool [`false`] | Percentage beside the level track |

## Contract

- Strip: notices `hud:volume`, `hud:mic`, `hud:brightness` at `priority::HUD` (100), hold
  1.5 s ([motion spec timing table](../06-motion-spec.md#timings-non-spring)), no text. Leading
  glyph `volume` / `volumeLow` / `volumeMedium` / `volumeHigh`
  (waves in thirds) or `volumeMuted`; `sun`; `mic` / `micMuted`. Trailing `level { percent,
  muted }` for volume and brightness; the mic notice is glyph-only.
- Commands: `get_hud_snapshot`, `hud_set_volume(percent)`, `hud_nudge_volume(delta)` (clamped,
  unmutes when turning up), `hud_set_muted`, `hud_set_mic_muted`,
  `hud_set_brightness(monitor_id, percent)`. Event `HudStateChanged { state }` with
  `HudState { volume, micMuted, monitors, osd }`.
- Start-up seeds the levels without a notice: the strip reacts to *changes* only.

## Visual

Strip trailing slot becomes a 96 px track with a white fill and a leading glyph (speaker with
0–3 waves, mute slash, sun for brightness, mic). Level text optional. Appears with a spring
scale-in, fades 1.5 s after the last change (the motion spec's timing table is canonical; an
earlier draft here said 1 200 ms).

## Acceptance criteria

- Given a volume key press, then the HUD updates within one frame and the Windows flyout does
  not appear.
- Given Muna crashes, then the Windows flyout is visible again within 2 s (watchdog).
- Given a DDC/CI-incapable monitor, then brightness controls are hidden for that monitor.

## Implementation notes (M2-E3 PR A)

Measured on the lab machine (Windows 11 build 26200, one internal panel, no external monitor);
every number is from a run of the `platform-tests` suite or the end-to-end trial script.

| Check | Result |
| ------- | -------- |
| Volume event latency (`IAudioEndpointVolumeCallback`) | 10.7 ms after the change |
| Brightness round trip (WMI set → event) | 20.9 ms |
| Flyout hidden after `set_suppressed(true)` | 5 ms |
| Flyout re-asserted after a foreign `SW_RESTORE` | ≤ 50 ms (`EVENT_SYSTEM_MINIMIZEEND` hook) |
| Flyout restored after a hard kill | 19–31 ms (watchdog; budget 2 s) |
| Volume key while suppressed | flyout stays hidden; Core Audio event still arrives |

Design decisions and deviations from the spec above:

- **No synthetic volume nudge at start-up.** Core Audio changes never create the flyout
  window; only a key press does, and a synthetic key would flash the flyout and fire two level
  events. The create/show hook catches the window the first time the shell makes it, so at
  most the first flyout of a session is visible for one frame. The state reads *unavailable*
  until then.
- **Watchdog is the same executable**: `muna.exe --watchdog <pid>` is handled in `main.rs`
  before Tauri starts (the single-instance plugin would otherwise forward the arguments and
  exit). It waits on the parent's process handle and restores the flyout. If it cannot be
  spawned nothing is suppressed.
- **A clean exit restores explicitly** (`RunEvent::Exit` → `HudService::shutdown`); the
  watchdog covers everything else.
- **`WH_KEYBOARD_LL` fallback for swallowed brightness keys is deferred** (P1 follow-up); the
  lab panel raises `WmiMonitorBrightnessEvent` for its keys.
- **Windows 10 (`NativeHWNDHost` ⊃ `DirectUIHWND`) is implemented but unverified** — no
  Windows 10 machine in the lab. Same explorer + z-band checks apply.
- **External DDC/CI is implemented but unverified on hardware**; `GetMonitorCapabilities`
  correctly excludes the internal panel (error 31), so an incapable monitor is never listed.
- Brightness monitors are re-read 1.5 s after a `MonitorsChanged` event (the platform's own
  probe runs on the same event) and immediately when an event names an unknown monitor.
- Until PR B lands its `LevelTrack`, the strip draws `level` with the progress track.
