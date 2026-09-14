# Calendar

**Tier P1 · Owner: `muna-module-developer` · Status: spec**

## Reference

`demo-09/10/13/17/27`, `calendar-feature-2`. Month jumper + month grid (today filled circle,
event dots) + agenda (blue time column, title, location with ↑, unread dot). Header chips
`Today`, month name; buttons grid/list/screenshot/refresh/‹ ›/search. Strip: next event
countdown ("Team standup in 10m") — becomes high priority ≤ 10 min before start.

## Providers

| Provider | Auth | API | Notes |
| ---------- | ------ | ----- | ------- |
| Microsoft 365 / Outlook.com | MSAL device-code or PKCE (public client) | Graph `/me/calendarView`, `/me/calendars`, delta queries, `onlineMeeting.joinUrl` | Teams join links |
| Google Calendar | OAuth PKCE (loopback) | `events.list` with `syncToken`, `conferenceData` | Meet links |
| ICS / CalDAV | URL (+ basic auth) | periodic fetch, `ical` parse; CalDAV `REPORT` | read-only |
| Windows Calendar (packaged only) | `appointments` capability | `AppointmentManager.RequestStoreAsync` | optional |

Reminders: Microsoft To Do / Google Tasks via the Todo module's providers (shared store).

## Behaviour

- Local cache (SQLite) of ±60 days; refresh every 5 min + on expand; delta sync where offered.
- Search title/location/notes/calendar name; filters: overdue reminders, all-day, calendar.
- Countdown and *Join* button when a meeting link exists; optional auto-notice 10/5/1 min before.
- Meeting awareness: when an event with a link is in progress, optionally enable Focus Assist
  and switch Dashboard profile.

## Acceptance criteria

- Given two accounts, then colours per calendar are preserved and events merge chronologically.
- Given offline, then cached events render with a subtle "offline" chip; no error dialogs.
- Given a Teams event starting in 5 min, then the strip shows the countdown and *Join* opens the
  link in the default handler.
