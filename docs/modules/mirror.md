# Mirror

**Tier P2 · Owner: `muna-shell-engineer` · Status: implemented (M5-E1c)**

## Purpose

Camera preview widget/module ("quick camera check before your call").

## Platform

`Windows.Media.Capture.MediaCapture` preview → frames to a `<canvas>` via shared texture is
overkill; v1 uses WebView2 `getUserMedia` (WebView2 supports it; permission via
`PermissionRequested` auto-grant for camera in our own origin). Mirror-flip toggle, aspect
crop, device picker. Shows the OS privacy indicator behaviour (camera light on).

## Acceptance criteria

- Preview starts ≤ 800 ms after the widget becomes visible; stops when hidden.
- No camera access unless the widget/module is enabled by the user.

## As built (M5-E1c)

### Where the camera lives

The webview owns the camera; Rust never sees a frame. The panel and the widget call
`getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })`
through one hook, `useCameraStream`, which runs the stream exactly as long as the caller is
mounted, the module is enabled and the document is visible:

- **Starts** on mount (the panel expands, the dashboard shows the card), on retry, when the
  chosen camera changes, and when the window becomes visible again.
- **Stops** — every track stopped, the OS light off — on unmount (collapse, module switch,
  the dashboard unmounting its widgets), when the module is turned off, when the window hides
  (`visibilitychange`), and before reopening on another camera.
- **Falls back** to the system default when the chosen `deviceId` is gone
  (`OverconstrainedError` / `NotFoundError` on the exact request); a refusal or a busy camera
  is not retried.
- **Names the failure**: `NotAllowedError`/`SecurityError` → *Camera access was refused*,
  `NotFoundError`/`OverconstrainedError` → *No camera found*, `NotReadableError`/`AbortError`
  → *The camera is in use*, no `navigator.mediaDevices` → *Camera preview is not available*,
  anything else → *The camera did not start*; each with *Try again*. A track that ends on
  its own (the camera unplugged) becomes *No camera found* rather than a frozen last frame.
- **Lists the cameras** after the first grant (`enumerateDevices`, video inputs with an id;
  labels are only revealed once a stream has been granted) and refreshes on `devicechange`.

### Permission (Rust, `muna-platform`)

There is no prompt the notch window could show, so Rust answers `PermissionRequested` for
both webviews (`windows/webview.rs`, installed on the settings window at start and on every
notch window when it attaches):

- **Camera** is allowed only while `settings.modules.mirror.enabled` is true **and** the
  request comes from the app's own origin (`same_origin(request uri, document uri)`; the
  production origin is `http://tauri.localhost`, dev `http://localhost:1420`).
- **Everything else** — microphone, geolocation, notifications, clipboard read, sensors,
  autoplay, local fonts, file read/write, MIDI, multiple downloads, window management,
  unknown kinds — is denied.
- Decisions are **not saved to the profile** (`SetSavesInProfile(false)`), so turning the
  module off applies to the next request without a restart; the log line
  `webview permission permission=Camera decision=Allow|Deny origin=…` marks each one.
- The policy itself (`PermissionPolicy`, `Origin`, `same_origin`) is pure and unit-tested;
  `MirrorService` owns it and syncs the camera flag from the settings. It is not a
  `WebviewPermissions` trait as the M5 plan tabled — like the memory target, it is a
  function of the webview the shell already holds, and there was nothing left to fake.

### The preview hold

A running preview must not be trimmed: `mirror_watch(watching)` tells Rust, per window
label, that a preview started or stopped; `MirrorService` turns the empty ↔ non-empty
transitions of that set into `Hold::MirrorPreview` on the shell's memory target
([notch-shell › Memory target](notch-shell.md#memory-target)). `watch(true)` is ignored while
the camera is locked (module off), `watch(false)` always lands, a destroyed window is
forgotten, and turning the module off clears every watcher.

### Settings

`settings.modules.mirror = { enabled: false, flip: true, deviceId: null, deviceLabel: null }`
(`MIRROR_SETTINGS_KEY`; Rust clamps `deviceId` to 256 code points and `deviceLabel` to 128,
and drops a label without an id). The pane offers *Use the camera* (off by default, with the
privacy promise spelled out), *Mirror the image*, and *Chosen camera* with *Use default*;
the camera itself is chosen from the panel's *Next camera* button, which stores the id with
its label so the pane can name it. Zoom (1×, 1.5×, 2×) is transient.

### Surfaces

- **Panel**: the head names the camera (or the state) beside a camera glyph and carries the
  controls — the *Mirror the image* chip, the zoom button, *Next camera* (two or more
  cameras) and *Settings*; the body is the picture in a 16:9 frame with continuous corners,
  `object-fit: cover`, mirrored and zoomed with a transform, or the empty/error state. Not a
  held panel: a collapse must stop the camera.
- **Widget**: the picture at the card's height, the module title and the camera's name; off,
  *Mirror is off · Turn it on in Settings*; an error in one line.
- **Stories**: `Modules/Mirror/*` replace `navigator.mediaDevices` with a painted canvas
  stream (`story-camera.ts`); no story or test ever opens a real camera.

### Manual verification (spike S1)

The three observations of [S1](../build-plan/m5-ship.md#spikes-with-exit-criteria) — the
preview starting without a prompt and the camera light coming on with the module on,
`NotAllowedError` with it off, and the light going off within a second of a collapse — are
rows 1–6 of the [QA checklist](../qa/checklists/mirror.md); they need a machine with a
camera and were not run in the agent session that built the module.
