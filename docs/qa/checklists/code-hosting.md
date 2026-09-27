# QA checklist · Code hosting

Covers the M4 exit criterion "GitHub rate-limit friendly in a 24 h soak" and the acceptance
criteria of docs/modules/code-hosting.md. The schedule, the backoff ladder, the notices and
every refusal are covered by `tests/code_hosting.rs` against the fake platform and scripted
queues; this checklist is the network, account and visual side, and it needs a GitHub account
with at least one repository the tester can open pull requests in.

The token pasted here goes to `api.github.com` only. Use a token made for the run and revoke it
at the end; never paste it anywhere else, and never commit or log it.

## Running it

1. Start Muna (`scripts\dev.ps1`). Settings → Code hosting is **off** with no account.
2. Have GitHub open in a browser as the same user, with a second account or a colleague who can
   request a review from you, and a repository with a workflow that runs on pull requests.
3. Drive the settings (rows 1–8), the panel (rows 9–18), the strip (rows 19–22), the network
   (rows 23–28) and the soak (row 29).
4. Paste the table below with the build and date, then **Disconnect** and revoke the token.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Open Settings → Code hosting | the privacy note names `api.github.com`, every two minutes and Windows Credential Manager; *Show pull requests* is off; the connect form shows with *Connect* disabled; both strip notices are on |
| 2 | Paste a token and press *Connect* while the switch is off | *Turn code hosting on first.* under the form; no request (the log has no `code hosting` line); the field keeps the token |
| 3 | Turn *Show pull requests* on, then *Connect* | *Checking the token…* then the form is replaced by *Connected as `login`* with *Disconnect*; the field is gone; the settings file (`%APPDATA%\Muna\settings.json`) has `"code-hosting": { "enabled": true, "notices": … }` and no token; Credential Manager → Windows Credentials lists `code-hosting.github.token` |
| 4 | *Create a token* | the browser opens `github.com/settings/tokens/new` with the description *Muna review queue* and the `repo` scope ticked |
| 5 | Paste `not a token` and *Connect* | *GitHub refused the token…* in one line; the field is cleared; nothing stored in Credential Manager |
| 6 | Paste a fine-grained token with *Pull requests* and *Metadata* read on the test repository | connects; private pull requests of that repository list; others do not |
| 7 | Turn *Show pull requests* **off** while connected | the account row stays; the panel says *Code hosting is off*; the token stays in Credential Manager; turning it on again shows the last queue at once and refreshes within a few seconds |
| 8 | *Disconnect* | the connect form is back; Credential Manager has no `code-hosting.github.token`; the panel says *No account connected*; a restart shows no rows |
| 9 | Open the panel with an account and a pending review request | the *To review* chip is selected; the count reads *N pull requests*; each row shows the author's initial, the title, `owner/repo #n`, *by author*, the GitHub chip and the change line `+a −d · n files · Checks … · Review …` |
| 10 | Chips *Mine* and *All* | *Mine* lists only pull requests you opened; *All* both; the count follows; the choice is not saved (a restart returns to *To review*) |
| 11 | ↗ on a row | the browser opens that pull request's page; the log has no title, author or repository name |
| 12 | *Refresh* | the button reads *Refreshing* and disables until the poll answers (well under 15 s on a good line); the footnote *Updated hh:mm* changes |
| 13 | A draft pull request | its row carries the draft glyph (*Draft* to assistive technology) before the title |
| 14 | A pull request whose checks are running, one whose checks failed, one approved | *Checks running*, *Checks failed* (red change line), *Approved* in the change line respectively |
| 15 | Nothing waiting for review, own pull requests open | *To review* shows *Nothing to review* with the *0 pull requests* count; *Mine* shows the rows |
| 16 | A title longer than the row, a repository name longer than its slot | both truncate on one line; the ↗ button keeps its place; the panel does not grow |
| 17 | Panel body with 25 rows under *All* | the list scrolls inside the panel at 60 fps; the header and the footnote stay |
| 18 | Reduced motion (Windows *Animation effects* off) | the panel body fades in without the spring; chips still tint |
| 19 | Ask a colleague to request your review on an open pull request, wait for the next poll | within two minutes the strip shows the pull-request glyph (purple) and *Review requested · title* for about four seconds; the row appears under *To review* |
| 20 | Push a commit to your own open pull request so the checks run, wait for them to finish | the strip shows a green check-circle and *Checks passed · title*, or a red x-circle and *Checks failed · title*; the change line updates |
| 21 | Turn *Announce finished checks* off, repeat row 20 | no notice; the change line still updates |
| 22 | Lock Windows for ten minutes while several pull requests change, unlock | at most three notices, newest first; the queue is current within a few seconds of unlocking; the log shows no poll while locked |
| 23 | Disconnect the network, wait for a poll (or *Refresh*) | the rows stay; the footnote reads *Offline, showing the queue from hh:mm*; no dialog; the log has one `code hosting poll failed` line |
| 24 | Stay offline for fifteen minutes, reconnect | the polls spaced out (2, 4, 8 min in the log); the queue refreshes within two minutes of the line coming back and the footnote reads *Updated* |
| 25 | Revoke the token on GitHub while connected | the next poll's footnote reads *GitHub no longer accepts the token. Connect again in Settings.*; no further polls (the log stops); Settings still shows *Connected as* with *Disconnect* |
| 26 | Delete `code-hosting.github.token` in Credential Manager while connected | the next poll ends the same way as row 25 (*Connect again in Settings*) |
| 27 | Start Muna offline with a cached queue | the rows and *Offline, showing the queue from hh:mm* show at once; the first poll after reconnecting refreshes them |
| 28 | Start Muna with the module on and a token, online | the cached queue shows first, then refreshes within seconds; no notice for what was already there |
| 29 | **24 h soak** connected with one open pull request of yours | about 720 polls in the log, none closer than two minutes, no `rateLimited` line, no growth of the working set over the day (`ci:app` idle numbers before and after); GitHub's rate-limit page shows the GraphQL budget far from exhausted |
| 30 | Windows 10 22H2 | rows 3, 9, 11, 19 and 23 |

## Results

Recorded per run; the first pass is in the M4-E4 PR description.
