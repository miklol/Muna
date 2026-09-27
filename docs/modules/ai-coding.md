# AI Coding

**Tier P2 · Owner: `muna-module-developer` · Status: built (M4-E5)**

## Reference

`demo-21`, `demo-28`. Session rows: terminal icon with status dot, project, `Running`/`Waiting`
chip, model chip (Opus/Sonnet/GPT), `CLI` chip, branch; task line; monospace current file;
elapsed; `28 msgs · 50.4k tok`; Recent section. Header: `3 active`, `Agents ›`, ⚡ (focus),
refresh.

## Sources (adapters)

| Agent | Signal |
| ------- | -------- |
| Claude Code | Hooks (`PreToolUse`, `Notification`, `Stop`) configured to POST to Muna's local endpoint `http://127.0.0.1:<port>/hooks/claude`; session JSONL under `%USERPROFILE%\.claude\projects\**` for history/tokens |
| GitHub Copilot CLI | session state dir `%USERPROFILE%\.copilot\session-state\*` (events.jsonl) — watch with `notify` |
| Cursor Agent / Codex CLI | log dirs where documented; generic adapter for JSONL |
| Generic | Any process can POST to the endpoint (documented schema) |

Allow/Deny: for Claude Code, respond to the hook (`decision: approve|block`) within its
timeout; otherwise focus the terminal window (`SetForegroundWindow`) and optionally send `y`
via `SendInput` (flagged).

## Acceptance criteria

- Waiting session → strip notice with Allow/Deny within 500 ms of the hook.
- Token counts match the CLI's own reporting ±2 %.

## Implementation notes (M4-E5)

Two sources feed one reducer. **Claude Code** posts its hook events to a loopback receiver and
waits for the answer, which is how *Allow* / *Deny* reach it; **GitHub Copilot CLI** has no
hooks, so its live sessions are found by their lock files and their logs are followed. Any
other process may post the generic document. Everything that decides is synchronous and takes
its clock, paths and platform from the constructor, so `tests/ai_coding.rs` drives the whole
module with temp folders, scripted pids and a `FakeClock`. Pieces, in the order an event flows:

- **Platform** (`muna-platform`): the `Processes` trait — `main_window(pid)` (the top-level
  window a process owns, so *Show* can bring a terminal forward through the shell's existing
  `WindowPlacement`) and `owner_of_local_port(port)` (`GetExtendedTcpTable` over IPv4 and
  IPv6, which is how a hook post's peer port becomes the CLI's pid and from there its window).
  `FakePlatform` scripts both.
- **Receiver** (`receiver.rs`, the plan's `LocalReceiver`): an HTTP/1.1 server on `127.0.0.1`
  and a **configured port** (default `47391`; the next ten are tried when it is taken, and the
  pane shows the live one) — the plan said *random*, but hook URLs are static configuration in
  the agents' own settings files, so the port is a setting. Every request carries the
  module's **bearer token**, 32 random bytes minted once per install and kept under
  `meta['ai-coding:token']` in the SQLite store (it protects a loopback port, not an account,
  so it does not go to Credential Manager); bodies are capped at 64 KiB, requests at 30 per
  second, and every connection closes after one exchange. Routes: `/health` (unauthenticated,
  says only that Muna listens), `/hooks/claude`, `/hooks/generic`. A `PermissionRequest` is
  **held**: the reply is written when the user decides on the strip or in the panel, or after
  **25 s** with the neutral reply so the CLI falls back to its own prompt (its hook timeout is
  30 s). Off, the receiver answers `503`.
- **Claude Code** (`claude.rs`): *Install hooks* writes `type: "http"` entries for
  `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest` (timeout 30),
  `Notification`, `Stop` and `SessionEnd` into `%USERPROFILE%\.claude\settings.json`, each with
  the receiver URL and an `Authorization: Bearer …` header, and *Remove hooks* takes exactly
  those out, leaving the rest of the file as it was (a file that is not valid JSON is refused
  with `aiCoding.hooksFile`, never overwritten). Every post names the session, its `cwd` and
  its transcript; the transcript is tailed for `message.usage` (tokens, messages) and the
  branch comes from the repository's own `HEAD` (`git.rs`, no `git` process). A
  `PermissionRequest` makes the session *waiting · permission* with the tool and its command
  or file as `detail`, **decidable**; a `Notification` with a permission text does the same
  without the hold; `Stop` is *waiting · input*, an idle notification *waiting · idle*. A
  session that posted nothing for 30 minutes is taken as gone. **Assumption**: Claude Code
  honours `headers` on `http` hooks; if a build does not, the documented escape hatch is a
  `type: "command"` hook running `curl -H "Authorization: Bearer …"` against the same URL.
  The plan's `SendInput('y')` fallback was **not built**: a decision only reaches an agent
  that can take it; otherwise the row offers *Show*.
- **Copilot CLI** (`copilot.rs`, `jsonl.rs`): live sessions are the folders under
  `%USERPROFILE%\.copilot\session-state` holding an `inuse.<pid>.lock`; `workspace.yaml` gives
  the working directory and the start; `events.jsonl` is followed with a `Tail` that reads only
  what was appended (a file over 8 MiB when first seen starts at its end and its counts are a
  lower bound, shown as `messages: null`). `assistant.turn_start` is *running*, `turn_end`,
  `abort` and `session.error` are *waiting · input*, the lock vanishing is *done*. The CLI
  reports no token usage, so `tokens` is `null` for these rows. No `notify` watcher: the
  service polls on a **cadence of 2 s while a Copilot turn runs or a window watches, 10 s
  otherwise, none while off or locked**, so an idle machine reads nothing.
- **Generic** (`/hooks/generic`): `{ agent, sessionId, status: running | waiting | done,
  project?, branch?, model?, task?, file?, message?, waitingKind?: permission | input | idle,
  tool?, pid?, messages?, tokens? }` with the bearer token; the session id is
  `generic:<agent>:<sessionId>` and `pid` lets *Show* find the window.
- **Strip** (`activities/mod.rs`): a decidable permission request is an **activity**
  `ai-coding:waiting:<session>` at `priority::AGENT_WAITING` (62) with `Glyph::Terminal`
  (orange) and `Trailing::Decision { session }`, retracted when the answer lands, the hold
  expires or the user dismisses it; any other stop for the user is a **notice** with the same
  glyph (blue) and the `agentWaiting` message, once per waiting spell. Both are off with
  `waitingNotice`. The shell's `DecisionButtons` pair sends `ai_coding_command({ kind: allow
  | deny })` and dims until Rust retracts the prompt; presses on the pills bypass the notch
  state machine like the HUD's level track, and the burst stays wide while the pair shows.
- **Snapshot and publishing**: `{ enabled, sessions, recent, receiver, generatedAtMs }` —
  live sessions waiting first (decidable first), then running, newest change first; finished
  sessions of the last 24 h (at most 20); the receiver's port, listening state, hook URL and
  whether Claude Code's file has our hooks. `AiCodingChanged` is published **only while a
  window watches** (`ai_coding_watch(true)` on mount, `false` on unmount) and after every
  command. The payload carries project names, branches and task lines — content, never
  logged.
- **Commands**: `get_ai_coding_snapshot`, `ai_coding_watch(on)`, `ai_coding_command({ kind:
  'refresh' | 'allow' | 'deny' | 'focus' | 'dismiss' | 'installClaudeHooks' |
  'removeClaudeHooks' })`. Error codes `aiCoding.unknown | notWaiting | noProfile | hooksFile
  | io`. Settings `settings.modules['ai-coding'] = { enabled (true), port (47391,
  1024–65525), copilotCli (true), waitingNotice (true) }`. Zod schemas and the helpers
  `waitingSessions` / `runningSessions` live in `@muna/contracts`.
- **Panel** (`src/modules/ai-coding/panel.tsx`): the counts (*3 active · 1 waiting*) and
  *Refresh*; each row the terminal glyph with a status dot (green running, orange waiting),
  the project with *Waiting* / *Running*, *CLI* and model chips, what the agent does or waits
  for (*Wants to run Bash* in orange with the command in the terminal's face, or the task and
  the file), and the meta line *agent · branch · waiting for 40 s · 28 msgs · 50.4k tok*;
  *Allow* / *Deny* where the prompt is decidable, *Show* where the terminal is known,
  *Dismiss* otherwise; *Recent* under the live rows. Empty states: *AI coding is off* (with
  *Open settings*), *No agents running* with either what starts one or, while Claude Code has
  no hooks, where to install them. A refused command explains itself in one line under the
  list. The panel has no timer: elapsed times are the snapshot's.
- **Widget**: *2 waiting · 1 running* (orange while anything waits) and the first three
  projects, waiting first; a wide card adds what each does. **Settings pane**: the privacy
  note, *Watch coding agents*, *GitHub Copilot CLI*, *Announce waiting agents*; then *Hook
  receiver* — the port (committed on Enter or blur, out-of-range entries dropped), *Listening
  on port N* with a dot, the hook URL, *Install hooks* / *Remove hooks* with the outcome in
  the row, and a note on other agents.

Deviations from the spec above, for the record: the receiver's port is configured, not
random; the bearer token lives in the store's `meta` table; no `SendInput` fallback; Copilot
CLI rows show no token count; Cursor and Codex have no adapter of their own yet (the generic
route stands in). QA rows are in [qa/checklists/ai-coding](../qa/checklists/ai-coding.md).
