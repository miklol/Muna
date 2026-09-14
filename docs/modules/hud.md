# Volume / brightness HUD

**Tier P0 · Owner: `muna-shell-engineer` · Status: spec**

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
  grabbed). Trigger a silent volume nudge on startup so the window exists, then
  `ShowWindowAsync(inner, SW_MINIMIZE)`; re-apply from a `SetWinEventHook(EVENT_OBJECT_CREATE…
  EVENT_OBJECT_STATECHANGE)` on explorer's PID with a 3 s re-hook timer (ModernFlyouts
  `NativeFlyoutHandler` technique). Restore on exit and via the watchdog on crash. Setting:
  *Replace system flyout* (default on). On builds where no flyout window exists for
  mouse-driven changes (observed on 26200) nothing is suppressed and nothing breaks.
- **Interaction**: HUD slider is draggable while shown; scroll wheel over the strip adjusts
  volume when the HUD is visible or when *Scroll on strip = volume* is on.

## Visual

Strip trailing slot becomes a 96 px track with a white fill and a leading glyph (speaker with
0–3 waves, mute slash, sun for brightness, mic). Level text optional. Appears with a spring
scale-in, fades 1 200 ms after the last change.

## Acceptance criteria

- Given a volume key press, then the HUD updates within one frame and the Windows flyout does
  not appear.
- Given Muna crashes, then the Windows flyout is visible again within 2 s (watchdog).
- Given a DDC/CI-incapable monitor, then brightness controls are hidden for that monitor.
