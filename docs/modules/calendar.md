# Calendar

**Tier P1 · Owner: `muna-module-developer` · Status: in progress (M3-E1: ICS subscriptions)**

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

### Implementation notes (M3-E1)

The first slice is **read-only ICS / webcal subscriptions** — the one provider row that needs
no OAuth client registration — so the panel, the strip form and the notice exist and can be
judged. Microsoft Graph, Google Calendar, CalDAV `REPORT`, the Windows `AppointmentStore`,
search and filters, meeting awareness (Focus Assist, profile switch) and the 5 / 1 min notices
are deferred; the module is `src-tauri/src/modules/calendar` + `src/modules/calendar`.

- **Nothing leaves the PC until a calendar is added.** Adding one sends the address to Rust
  once (`calendar_add_source(name, url, color)`); it is refused when it is not a URL, not
  `https` / `webcal`, or carries a user name and password (`calendar.url.malformed` / `.scheme`
  / `.credentials`). `webcal://` is read as `https://`. The address is a bearer secret and is
  kept in **Windows Credential Manager** under the source id through the new
  `muna_platform::Secrets` trait (`CredWriteW` / `CredReadW` / `CredDeleteW`, generic
  credentials persisted to the local machine, target `Muna/calendar:ics:<id>`; `FakePlatform`
  keeps an in-memory vault). The settings
  document holds only `{ id, name, color, enabled, host }` so an export never contains a link,
  and a missing vault entry shows as *The link is missing on this PC* (`FeedError::MissingLink`)
  rather than as a silent empty calendar.
- **Fetch.** One `GET` per enabled source per refresh period (5 / 15 / 30 / 60 min, default 5),
  on *Refresh* and on unlock (the "+ on expand" in Behaviour is deferred); `Accept:
  text/calendar`, 15 s timeout, 5 MiB cap, a body that
  does not start with `BEGIN:VCALENDAR` is `Invalid`, a 4xx/5xx is `Refused` (the panel says the
  link may have expired), no route is `Offline`. A failure retries 1 → 2 → 4 … min up to the
  refresh period. The last good feed is kept in the store (`calendar:cache:<id>`) with its
  time, so an offline start renders it under an *Offline* chip — never a dialog.
- **Parsing** is Muna's own permissive reader (`ics.rs`): folded lines, TEXT unescaping,
  `VALUE=DATE`, `Z`, IANA `TZID`s and the Windows display names Outlook writes (unknown zones
  fall back to the machine's zone — a documented limitation), `DURATION`, `RRULE` / `RDATE` /
  `EXDATE` through the `rrule` crate, `RECURRENCE-ID` overrides, `STATUS:CANCELLED`. Each event
  yields its occurrences inside a **±60-day window** around today (at most 400 per rule). The
  meeting link is the conferencing property, then `URL`, then the first link to a known
  meeting host (Teams, Meet, Zoom, Webex, GoToMeeting, Whereby, Jitsi) in the location or the
  description; `is_meeting` drives the *Join* wording.
- **Strip and notice.** The next timed event starting within 60 min publishes `calendar:next`
  (calendar glyph, title, the start time trailing) at `EVENT_UPCOMING` (50, under a task due);
  from 10 min before it rises to `EVENT_STARTING` (65), which outranks playing media, and one
  notice (`calendar:starting:<event id>`) fires. The activity stays 15 min past the start. Both
  are switches in Settings. The strip has no press-to-act path yet, so *Join* lives in the
  panel (`calendar_open`) and the acceptance criterion's "*Join* opens the link" is met there,
  not from the notice.
- **Contract.** `get_calendar_snapshot` → `CalendarSnapshot { sources: SourceView[], events,
  windowStartMs, windowEndMs, offline }`; `calendar_command(Refresh)`; `calendar_add_source` →
  the saved `SourceSetting`; `calendar_remove_source(id)` → the saved `Settings` (the vault
  entry and the cache go with it); `calendar_open(eventId)` (`calendar.noLink`); event
  `CalendarChanged`. `SourceView.status` is `idle | fetching | ok | error { error: FeedError }`.
- **UI.** The panel is the month on the left — a new `MonthGrid` primitive in `@muna/ui` on
  React Aria `Calendar` (six fixed rows, locale week start, today as a filled accent circle,
  up to three event dots in the calendars' colours) — and the selected day's agenda on the
  right: a tinted bar and time column, title, place, *Join* / *Open*; the *Join* button is
  primary while the call is on. The *Events* dashboard widget lists the next three events. The
  "now" state comes from a shared minute clock (`lib/minute-now.ts`) that only ticks while a
  panel is mounted. Settings → Calendar lists the calendars with host and fetch state, a
  show / remove control each, the add form (name, link, colour), the refresh period and the
  strip switches; it leads with what leaves the PC and where the links are kept.
- **Tests.** `tests/calendar.rs` drives the reducer with a fake clock and scripted feeds
  (parsing fixtures, zones, recurrence, the strip and notice timeline, the vault, offline and
  refused paths); Vitest covers the agenda helpers, the panel, the widget and the settings pane
  with the contract mocked.
