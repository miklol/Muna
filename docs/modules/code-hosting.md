# Code hosting

**Tier P1 · Owner: `muna-module-developer` · Status: spec**

## Reference

`demo-16`, `demo-24`, `git-feature-2/3/4`. Left nav: PRs/MRs (count), Pipelines, Jira.
Rows: avatar, title, `repo #num` + provider chip, `+64 −51 · 6 files · Pipeline running`,
provider logo, ↗. Header chip `All ›` (filter: to review / mine / all).

## Providers

| Provider | Auth | Data |
|----------|------|------|
| GitHub | OAuth device flow (Muna app) or PAT | GraphQL `search(review-requested:@me)`, `author:@me`, checks status, notifications |
| GitLab | PAT / OAuth PKCE | `/merge_requests?reviewer_id=me`, pipelines |
| Bitbucket Cloud | app password / OAuth | pull-requests `reviewers`, pipelines |
| Jira Cloud | API token / OAuth | JQL search, transitions (`POST /issue/{id}/transitions`) |

Poll every 2 min (adaptive backoff), manual refresh, ETag/If-None-Match. Strip: notice when a
review is requested or a pipeline fails (optional). Dashboard: "PR review queue" widget.

## Acceptance criteria

- New review request → row appears within one poll; clicking ↗ opens in browser.
- Jira transition changes status without leaving the notch and shows a success notice.
