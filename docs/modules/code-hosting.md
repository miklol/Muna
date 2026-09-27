# Code hosting

**Tier P1 · Owner: `muna-module-developer` · Status: implemented for GitHub with a personal
access token (M4-E4; the device flow, GitLab, Bitbucket and Jira are deferred — see
[Implementation notes](#implementation-notes-m4-e4))**

## Reference

`demo-16`, `demo-24`, `git-feature-2/3/4`. Left nav: PRs/MRs (count), Pipelines, Jira.
Rows: avatar, title, `repo #num` + provider chip, `+64 −51 · 6 files · Pipeline running`,
provider logo, ↗. Header chip `All ›` (filter: to review / mine / all).

## Providers

| Provider | Auth | Data |
| ---------- | ------ | ------ |
| GitHub | OAuth device flow (Muna app) or PAT | GraphQL `search(review-requested:@me)`, `author:@me`, checks status, notifications |
| GitLab | PAT / OAuth PKCE | `/merge_requests?reviewer_id=me`, pipelines |
| Bitbucket Cloud | app password / OAuth | pull-requests `reviewers`, pipelines |
| Jira Cloud | API token / OAuth | JQL search, transitions (`POST /issue/{id}/transitions`) |

Poll every 2 min (adaptive backoff), manual refresh, ETag/If-None-Match. Strip: notice when a
review is requested or a pipeline fails (optional). Dashboard: "PR review queue" widget.

## Acceptance criteria

- New review request → row appears within one poll; clicking ↗ opens in browser.
- Jira transition changes status without leaving the notch and shows a success notice.

## Implementation notes (M4-E4)

The first network integration of the app, so the shape follows the weather and calendar
modules: nothing leaves the PC until the user turns the module on **and** pastes a token, one
provider adapter behind a trait, a synchronous reducer on a fake clock, and the last good
queue cached for an offline start. Pieces, in the order a poll flows:

- **Provider** (`src-tauri/src/modules/code_hosting/provider.rs`): GitHub's **GraphQL** API
  with one request per poll — `viewer { login avatarUrl }` and two `search` aliases
  (`is:pr is:open archived:false review-requested:@me` and `… author:@me`, 25 rows each) with
  the `statusCheckRollup` of the last commit and the `reviewDecision` — over `reqwest` with a
  15 s timeout, a 2 MB body cap and Muna's user agent. The token travels in the
  `Authorization` header and nowhere else; it is normalised (trimmed, header-safe, at most
  255 characters) and its `Debug` prints nothing. Answers reduce to `CodeHostError::{Offline,
  Unauthorized, RateLimited, Provider}` — never the host's message, the UI has one sentence
  per case. `CodeHost` is the trait the fake queues implement and where GitLab or the device
  flow would plug in; `Provider` is a closed enum (`gitHub` only) like the strip glyphs.
- **Service** (`mod.rs`, Tauri-free `CodeHostingService`): polls every **2 minutes** while
  the module is on and an account is connected, backing off 2 → 4 → 8 → 16 → 30 minutes on
  consecutive failures and stopping altogether on `Unauthorized` until the user connects
  again; **paused while the session is locked** and woken on unlock, on a command and on a
  settings change. The token is read from the credential vault (`code-hosting.github.token`)
  at every `plan()`, so removing it there ends polling with *unauthorized*. The last good
  queue and its time live in `Store` meta (`code-hosting:queue`) and are restored at start,
  so an offline launch shows the queue with *Offline, showing the queue from 10:05*.
  *Connect* checks the token by fetching with it once (refused while the module is off, so
  the pane cannot cause a request before the switch), stores it, and adopts the queue as the
  **baseline** — no notices for what was already there. *Disconnect* forgets the token, the
  account and the cache. Turning the module **off** keeps the token and the cache and only
  stops the clock; the snapshot keeps naming the account so the pane still offers
  *Disconnect* — nothing stored hides behind the switch — and turning it back on resumes
  from the cache.
- **Strip**: two optional notices (`settings.modules["code-hosting"].notices`), both on by
  default, both at priority 45 (`priority::CODE_HOSTING`, between *Event upcoming* and
  *Unread*): `code-hosting:review:<id>` — pull-request glyph, purple, wide text *Review
  requested · title* — when a row newly asks for the user's review and is not their own; and
  `code-hosting:checks:<id>` — check-circle green or x-circle red, *Checks passed / failed ·
  title* — when the checks on one of their own pull requests go from *pending* to a verdict.
  At most **three notices per poll**, so a long lock is not replayed change by change. No
  live activity: a poll has nothing to count down.
- **Contract**: `get_code_hosting_snapshot`, `code_hosting_command({ kind: 'refresh' })`,
  `code_hosting_connect(token) -> Result<Snapshot, IpcError>` (codes `codeHosting.disabled |
  token.empty | token.malformed | offline | unauthorized | rateLimited | provider | vault`),
  `code_hosting_disconnect`, `code_hosting_open(id)` (the URL comes from the fetched row,
  never from the UI), `code_hosting_open_token_page` (GitHub's *new token* page with the
  `repo` scope pre-filled) and the `CodeHostingChanged { snapshot }` event. The snapshot
  carries `enabled`, `account`, `pullRequests[]` (`repo`, `number`, `title`, `author`,
  `draft`, `additions`, `deletions`, `changedFiles`, `checks`, `reviewDecision`,
  `reviewRequested`, `mine`), `fetchedAtMs`, `fetching` and `error`. Zod schemas and the
  `filterPullRequests` helper live in `@muna/contracts`. The Rust `FetchError` of this module
  became `CodeHostError`: specta refuses two exported types with one name (the weather module
  owns `FetchError`).
- **Panel** (`src/modules/code-hosting/panel.tsx`): the reference's `All ›` header chip is
  three **filter chips** — *To review*, *Mine*, *All* — kept in the module's Zustand store
  (a view choice, not a setting), the count and a refresh button that disables while a poll
  runs. A row shows the author's **initial** in a circle, the title with a draft glyph when
  it is one, `repo #number`, *by author*, the host's name, the change line `+64 −51 · 6 files
  · Checks running · Review required` (numbers in the window's locale, `data-checks` for the
  colour) and ↗ (*Open title on GitHub*) through `code_hosting_open`. Under the list, one
  footnote: *Updated 10:05* or the poll's sentence; a failed poll keeps the last rows. Off, or
  without an account, an empty state points at Settings. No timer in the panel: the clock is
  Rust's.
- **Widget** (`widget.tsx`): *N waiting for your review* and the first three titles; a wide
  card adds `repo #number`; one line for off, unconnected and nothing waiting.
- **Settings pane** (`settings.tsx`): what leaves the PC and where the token is kept, *Show
  pull requests*, then either the connect form — a masked token field (`TextField secret`,
  `type="password"`, no autocomplete, cleared after every answer), *Create a token* (opens
  the pre-filled GitHub page through Rust) and *Connect*, with the refusal explained under it
  in one line (`role="status"`) — or *Connected as login* with *Disconnect*; and the two
  strip notices. The switch and the notices go through the settings document; the token
  never does. Namespace `settings.modules["code-hosting"] = { enabled: false, notices: {
  reviewRequested: true, checksFinished: true } }`.
- **Deviations from the spec above**: GraphQL instead of REST, so ETag / `If-None-Match` and
  `X-Poll-Interval` do not apply — one request per poll every two minutes, the backoff and
  `RateLimited` handling are the rate-limit friendliness; **no avatars** — the notch's CSP
  allows only local images and the UI makes no network calls, so a row shows the author's
  initial (a Rust-side avatar proxy could come later); **no live activity** for finished
  checks, a notice instead; **PAT only** — the device flow (spike S4) needs a registered
  OAuth client id from the maintainer and plugs into the same `CodeHost` trait; no `Http`
  platform trait — `reqwest` stays inside the module behind `CodeHost`, as the weather and
  calendar providers do, and only `Secrets` comes from `muna-platform`; the token is read at
  every poll rather than held in memory; the **provider chip** is caption text — the 24 px
  `Chip` inside a row shares the filter chips' button shape without being one, and reads as
  a second toolbar (a provider logo waits for a second host). **Deferred**: GitLab,
  Bitbucket, Jira and its transitions, GitHub notifications and pipelines as their own lists,
  the left nav with counts, a press-to-act strip, more than 25 rows per list.
- **Tests**: `tests/code_hosting.rs` (30 cases on the fake platform and scripted queues: the
  schedule, the baseline after connect and restore, notices for a new review request and a
  verdict with the per-poll cap, the backoff ladder, unauthorized stopping the clock, the
  vault losing the token, the lock pause, disconnect forgetting everything — also while off —
  off keeping the token and the account, the cache round trip, `url_for`, token
  normalisation), contract schema round-trips,
  Vitest for the formatting helpers, the panel (filters, open, refresh, the events, the empty
  states), the widget and the pane (switch and notices saved, *Turn code hosting on first*,
  connect clearing the field and replacing the form, a refusal, disconnect, the token page);
  Storybook stories for the panel and the pane with play tests for the filters, a connect and
  a refusal. Application rows in the [checklist](../qa/checklists/code-hosting.md).
