# QA checklist · Mirror

Covers the acceptance criteria of docs/modules/mirror.md — the preview starts within 800 ms
of the panel or the card showing and stops when they hide; no camera access until the user
turns the module on — and the three observations of spike S1 in
[m5-ship](../../build-plan/m5-ship.md#spikes-with-exit-criteria). The permission policy, the
origin check, the preview hold and the settings clamps are covered by
`crates/muna-platform/src/permissions.rs` and `tests/mirror.rs`; the stream's lifetime by
`use-camera-stream.test.ts` against a scripted `navigator.mediaDevices`. This checklist is
the side only a machine with a camera can show: the OS privacy light, WebView2's real
`PermissionRequested`, and timing. Rows 1–6 are spike S1; they need a stopwatch.

## Running it

1. Start Muna (`scripts\dev.ps1`) on a machine with at least one camera (a second one — a
   USB webcam — for rows 12–14). Settings → Mirror shows *Use the camera* **off**, *Mirror
   the image* on, *Chosen camera · The system default*.
2. Watch the camera light (or Windows's *Camera in use* taskbar icon) throughout.
3. Drive the permission and the light (rows 1–6), the panel (rows 7–14), the widget and the
   window (rows 15–18), the errors (rows 19–22), the settings (rows 23–25), motion, keyboard
   and budgets (rows 26–29).
4. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | With *Use the camera* off, open the Mirror panel | *Mirror is off · Turn it on in Settings to check your camera before a call. Muna opens the camera only while this panel is on screen.* with *Open Settings*; the camera light stays off; the log has no `webview permission` line |
| 2 | Still off: in the notch webview's DevTools console, `navigator.mediaDevices.getUserMedia({ video: true })` | rejects with `NotAllowedError`, no prompt of any kind; the log reads `webview permission permission=Camera decision=Deny origin=http://tauri.localhost` (dev: `http://localhost:1420`) |
| 3 | Settings → *Use the camera* on, open the panel, start the stopwatch at the click | the head reads *Starting the camera* and then the camera's name; the picture is up within 800 ms; the camera light comes on; the log reads `… decision=Allow`; no Windows prompt appeared |
| 4 | Move the pointer away so the panel collapses, stopwatch at the collapse | the light goes off within a second; the log reads `webview memory target target=Low …` about 30 s later (the hold is released with the preview) |
| 5 | Open the panel, then Settings → *Use the camera* off while it shows | the picture goes at once and the panel reads *Mirror is off*; the light goes off within a second; a `getUserMedia` from the console now rejects again |
| 6 | Turn the module on again without restarting Muna, open the panel | the picture is back: the decision was not saved to the profile, so the new setting applies to the next request |
| 7 | Open the panel with the camera on | head: the camera glyph, the camera's name, then *Mirror the image* (selected), *1×*, *Settings*; the body is the picture in a 16:9 frame with rounded corners, mirrored (raise your right hand — it rises on the right of the picture) |
| 8 | Click *Mirror the image* | the picture flips to the way others see it (your right hand rises on the left); the chip deselects; Settings → Mirror shows *Mirror the image* off; the setting survives a restart |
| 9 | Click *1×*, then again, then again | the picture zooms to *1.5×*, *2×*, back to *1×*, centred each time; the button keeps its width; nothing is written to settings |
| 10 | Tab through the panel | focus lands on *Mirror the image*, the zoom button (named *Zoom 1*, *Zoom 1.5* or *Zoom 2*), *Next camera* if present, *Settings*; the picture itself is not a stop and reads *Camera preview* to Narrator |
| 11 | Switch the module in the module bar and back | the light goes off on the switch and on again with the panel; the picture returns on the same camera |
| 12 | Plug in a second camera while the panel shows | *Next camera* appears in the head within a few seconds (`devicechange`) |
| 13 | Click *Next camera* | the picture switches to the other camera and the head names it; the light of the first goes off; Settings → Mirror reads *Chosen camera · Desk camera. Switch cameras from the panel.* (the camera's own name) |
| 14 | Unplug the chosen camera, open the panel | the panel falls back to the default camera without an error; plugging it back in and clicking *Next camera* returns to it |
| 15 | Dashboard → *Add a widget* → Mirror | the card shows a small picture at the card's height with *Mirror* and the camera's name; the light is on while the dashboard shows the card |
| 16 | Collapse the dashboard | the light goes off within a second |
| 17 | With the module off, the Mirror card | *Mirror is off · Turn it on in Settings* and a struck camera glyph; the light stays off |
| 18 | With the panel showing, lock Windows (Win+L), unlock | the light goes off while locked and comes back within a second of the notch showing again |
| 19 | Windows Settings → Privacy & security → Camera → *Let desktop apps access your camera* off, open the panel | *Camera access was refused · Windows or another setting blocked the camera. Check Settings › Privacy › Camera, then try again.* with *Try again*; turning the Windows setting on and pressing *Try again* brings the picture |
| 20 | Open the camera in another app that takes it exclusively (some conferencing apps), then the panel | *The camera is in use · Another app has the camera. Close it there, then try again.*; closing the other app and *Try again* brings the picture |
| 21 | Disable the only camera in Device Manager, open the panel | *No camera found · Connect a camera, or pick another one in the module's settings.* |
| 22 | Unplug the camera while the picture shows | the panel reads *No camera found* rather than a frozen frame |
| 23 | Settings → Mirror, read the pane | *Use the camera* with *Off by default. Muna opens the camera only while the Mirror panel or widget is on screen, never in the background; the camera light shows when it is in use.*; *Mirror the image*; *Chosen camera* with *Use default* disabled while the default is in use |
| 24 | After row 13, press *Use default* | the description reads *The system default. Switch cameras from the panel.*; the button disables; the panel opens the default camera next time |
| 25 | Edit `settings.json` by hand: a 400-character `deviceId`, a `deviceLabel` without a `deviceId` | Rust trims the id to 256 code points and drops the label; the pane still reads |
| 26 | Reduced motion (Windows *Animation effects* off) | the panel body fades in only |
| 27 | Task Manager → Details, sort by CPU, panel closed for five minutes with the module on | `muna.exe` and `notch.exe` together stay under 0.3 % CPU; the light is off the whole time |
| 28 | Panel open for a minute with the picture showing | the notch process stays under 90 MB private working set with the picture; no `webview memory target target=Low` line while it shows |
| 29 | Windows 10 22H2 | rows 3, 4, 19 |

## Results

| Build | Date | Machine | Rows passed | Notes |
| ----- | ---- | ------- | ----------- | ----- |
| | | | | |
