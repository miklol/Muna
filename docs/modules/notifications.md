# Notifications

**Tier P1 · Owner: `muna-module-developer` + `muna-shell-engineer` · Status: spec**

## Reference

`demo-18`, `demo-25`, `notifications-feature-2/3`. Cards: app icon 36, app name, title, 2-line
body, relative time, hover actions (reply / open / dismiss). Header: count badge, `Apps ›`
filter chip, `…` menu (clear all, mute app). Strip: unread glance (app icon + name).

## Platform

- `Windows.UI.Notifications.Management.UserNotificationListener.Current` —
  `RequestAccessAsync()` (user consent in Settings → Privacy → Notifications), then
  `GetNotificationsAsync(NotificationKinds.Toast)` + `NotificationChanged` event; per
  notification: `AppInfo.DisplayInfo` (name, logo), `Notification.Visual.GetBinding(
  KnownNotificationBindings.ToastGeneric)` → text elements; `RemoveNotification(id)`.
- **Requires package identity** → MSIX build (ADR-0003). In the unpackaged build the module is
  hidden and Settings explains why, offering the MSIX download.
- Reply/actions: WinRT does not expose toast actions to listeners; *Open* activates the app via
  `AppInfo` → `ActivationInfo`/protocol when known; *Reply* is best-effort for apps with a
  documented protocol (Teams `msteams:`, Slack `slack://`) — otherwise open the app.
- **Focus Assist**: read state via `Windows.UI.Notifications` quiet-hours? Not public; use the
  `NtQueryWnfStateData` WNF `WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED` (undocumented, flagged)
  or open `ms-settings:quiethours`. Show state as a moon glyph.

## Behaviour

Group by app; mute apps; mark read on expand; clear individual or all (also removes from the
Action Center); notice in strip on arrival (optional, respecting Focus Assist).

## Acceptance criteria

- Given consent granted, then new toasts appear in the panel within 300 ms of arrival.
- Given consent denied, then the module shows a single explanatory state with a button to open
  Windows Settings; no polling.
- Given *Hide from captures* is on, then notification content never appears in captures.
