# Mirror

**Tier P2 · Owner: `muna-shell-engineer` · Status: spec**

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
