# Notifications

**Tier P1 · Owner: `muna-module-developer` + `muna-shell-engineer` · Status: implemented
(M3-E5; reply, the Win10 Focus Assist read and a filter chip deferred — see
[Implementation notes](#implementation-notes-m3-e5); hardware and installer rows in
[qa/checklists/notifications](../qa/checklists/notifications.md))**

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
- **Requires package identity** for `NotificationChanged` only → MSIX build (ADR-0003). In the
  unpackaged build the module stays available and re-reads the Action Center once a second
  (M0 measured the fallback; see [Implementation notes](#implementation-notes-m3-e5)).
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

## Implementation notes (M3-E5)

- **Platform.** `muna-platform::Notifications` (`access`, `request_access`, `list`, `watch`,
  `dismiss`, `clear`, `open_app`, `focus_active`) over `UserNotificationListener` in
  `windows/notifications.rs`; the fake scripts arrivals, removals, access answers and focus
  changes so `tests/notifications.rs` (33 cases) runs without Windows. Every listener call
  blocks on the OS and runs on the blocking pool. `watch` subscribes `NotificationChanged` and
  answers `Push`; without package identity the subscription is refused — `ERROR_NOT_FOUND` on
  Windows 11 (measured in M0), `E_ACCESSDENIED` on Windows Server 2025 (measured on the hosted
  CI runner) — and it answers `Polling`, so **the unpackaged build is not hidden as the spec
  said** — it works, re-reading the Action Center once a second, and Settings › Notifications
  says so (*Checked every second*). The listener keeps the projections it has
  made by id (a toast's sender and text never change; a replacement is a new id), so a poll
  costs one `GetNotificationsAsync` and an `Id` read per toast — the `ci:app` smoke measured
  the idle tree at 0.55 % of one core with the cache against 0.97 % projecting every toast
  every second. Sender logos come from
  `AppInfo.DisplayInfo.GetLogo(48)` as data URLs, cached per sender (64 entries).
- **Reducer.** `NotificationsService` re-reads the list on every event or poll and diffs ids —
  the same path for push and polling. Arrivals from unmuted senders raise one
  `notifications:arrived:<id>` notice each (priority *Unread* 40, oldest first so the newest
  shows), held back when a focus session is on or `SHQueryUserNotificationState` says busy or
  quiet hours; the `notifications:unread` activity (latest unread sender's logo, the count in
  the trailing slot, "sender · title" wide) stands while anything from an unmuted sender
  is unread and retracts on *mark read*. Muting is a setting (`settings.modules.notifications
  = { arrivalNotices, showUnreadInStrip, mutedApps }`), so it saves like any other and Rust
  re-emits its snapshot.
- **Focus** is `FocusSessionManager` read-only (`IsFocusActive` + its change event, Windows
  11 22H2+; `None` before). The panel header shows *Focus on* while a session is on and
  opens `ms-settings:quiethours`; toggling needs a Limited Access Feature token and is not
  attempted. The Win10 WNF read stays unimplemented.
- **Contract.** `get_notifications_snapshot`, `notifications_command` (`requestAccess`,
  `refresh`, `markRead`, `dismiss`, `dismissApp`, `clear`, `open`), `notifications_open_settings`
  (`privacy` | `focus`), `NotificationsChanged`; `Trailing.count` and `StripMessage.notification`
  join the strip vocabulary. Notification content never reaches the logs — counts and ids only.
- **Panel.** Groups by sender, newest sender first, 36 px logo or the sender's initial on a
  disc, name and count; cards carry the title, two lines of body, the relative time (moves
  with the shared minute clock) and *Open* / *Dismiss* on hover, focus or touch. Opening the
  panel marks everything read (the glance retracts) while the cards that were unread keep a dot
  until the panel closes, and the header counts them. *Open* brings the sender to the front
  through its `shell:AppsFolder` entry and removes the toast, as Windows does. A toast gone by
  the time a command reaches Rust answers `platform.notFound`; the panel re-reads instead of
  leaving a stale card. One explanatory state each for *unspecified* (*Allow* shows the
  consent prompt), *denied* (Windows Settings, then *Check again*) and *unavailable*; none
  polls.
- **Deviations from the reference.** No `Apps ›` filter chip and no `…` menu: mute and clear
  are per-sender buttons on the group row, *Clear all* is in the header. **Reply** is
  deferred — the listener exposes no actions and protocol replies need per-app knowledge.
  Capture hiding is the notch window's affinity (M1), not the module's.
- **Deferred.** Reply and app protocols, the Win10 Focus Assist read, a filter chip, a
  press-to-act strip (open the latest from the glance), grouping by conversation.
