# QA checklist · Notifications

Covers the M3 exit criterion "Notifications module works in MSIX (events) and NSIS (polling)
builds" and the acceptance criteria of docs/modules/notifications.md that need a real Action
Center. Access states, grouping, muting, the glance and the notices are covered by
`tests/notifications.rs` and the Vitest suite; this checklist is the two installers and the
visual side.

## Running it

1. Install the build under test: the MSIX (package identity, `NotificationChanged`) or the NSIS
   / unpackaged one (1 s polling). Settings › Notifications › *Delivery* says which one Windows
   gave Muna.
2. On a fresh profile, open the Notifications panel: Windows shows the consent prompt once.
3. Send test toasts from two apps (for example Mail and a browser) and watch the strip and the
   panel. `powershell -c "New-BurntToastNotification"` works when a real sender is not handy.
4. Paste the table below with the build, the Windows build and the date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | First open, never asked | *Let Muna show your notifications* with *Allow*; the Windows prompt appears; nothing polls before the answer |
| 2 | Answer *No* | *Notifications are turned off for Muna*; *Open Windows Settings* lands on Privacy › Notifications; *Check again* after turning it on shows the list |
| 3 | A toast arrives (MSIX) | the strip shows the sender's logo and "sender · title" within 300 ms; the panel lists it under its sender |
| 4 | A toast arrives (NSIS / unpackaged) | the same within about a second; *Delivery* reads *Checked every second* |
| 5 | Two toasts from two senders | two groups, newest sender first; the glance shows the latest sender with the count on the right |
| 6 | Open the panel | the glance retracts; the cards that were unread keep their dot; the header counts them; closing and reopening clears the dots |
| 7 | *Open* on a card | the sender comes to the front; the card leaves the panel and the Action Center |
| 8 | *Dismiss* on a card | the card leaves both; the count drops |
| 9 | *Clear Mail* | every Mail card leaves both; the group leaves when empty |
| 10 | *Clear all* | the Action Center empties; *No notifications* |
| 11 | *Mute Mail* then a Mail toast | no notice, no glance, the group shows *Muted*; Settings › Notifications lists Mail with *Unmute* |
| 12 | Focus session on (Windows 11 22H2+) | header shows *Focus on*; a toast raises no notice; the panel still lists it; *Focus on* opens Windows focus settings |
| 13 | Fullscreen game or presentation | a toast raises no notice; the glance still updates |
| 14 | *Announce new notifications* off | no notice; the glance still shows |
| 15 | *Show unread in the strip* off | no glance; notices still show |
| 16 | *Hide from captures* on, then a screen capture | the notch shows nothing of the notification content |
| 17 | Sender without a logo | the sender's initial on a disc; assistive technology hears the sender's name |
| 18 | Relative times | "Just now" under a minute, then minutes, hours, days; the times move at the whole minute |
| 19 | Windows 10 22H2 | rows 1–11 (no focus session state; the header has no focus button) |
| 20 | Windows Server / N edition without the listener | *Notifications are not available*; nothing to press; nothing polls |

## Results

Recorded per run; the first pass is in the M3-E5 PR description once the packaged build runs
in CI.
