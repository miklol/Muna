# AI Coding

**Tier P2 · Owner: `muna-module-developer` · Status: spec**

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
