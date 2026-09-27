# QA checklist · AI coding

Covers the acceptance criteria of docs/modules/ai-coding.md: a waiting session reaches the
strip with *Allow* / *Deny* within 500 ms of the hook, and token counts match the CLI's own
reporting within 2 %. The reducer — hook parsing, the held permission request and its 25 s
neutral reply, the Copilot lock and log follow, the silence rule, *Recent*, the strip activity
and notice, the hooks installer and the settings bounds — is covered by `tests/ai_coding.rs`
against the fake platform, temp folders and a pinned clock; this checklist is the desktop,
timing and visual side. Rows 1–6 need Claude Code and GitHub Copilot CLI installed; rows 7–9
need only `curl`.

## Running it

1. Start Muna (`scripts\dev.ps1`). Settings → AI coding shows *Watch coding agents* on, port
   *47391*, *Listening on port 47391*, the hook URL and *Install hooks*.
2. Press *Install hooks*; open `%USERPROFILE%\.claude\settings.json` and check the seven
   `http` entries carry the URL and an `Authorization` header, and that nothing else changed.
3. Drive the agents (rows 1–6), the receiver by hand (rows 7–9), the panel (rows 10–17), the
   pane (rows 18–22), the widget and motion (rows 23–25).
4. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Start `claude` in a repository and give it a prompt that edits a file | within a poll the panel lists the session: the repository's folder name, *Running*, the model chip, the branch, the prompt's first line as the task, the edited file in the terminal's face, *running for N s · N msgs · N tok* |
| 2 | Let Claude Code ask permission to run a shell command | the strip goes wide within 500 ms of the prompt appearing in the terminal (stopwatch): terminal glyph in orange, *Claude Code wants to run Bash*, the *Allow* / *Deny* pair; the panel row reads *Waiting* with *Wants to run Bash* in orange and the command below |
| 3 | Press *Allow* on the strip | the CLI runs the command without its own prompt; the pair dims for the round trip and the strip collapses; the row is *Running* again |
| 4 | Let it ask again and wait 30 s without answering | after 25 s the strip collapses on its own and the CLI shows its own prompt; the row stays *Waiting* with *Show* and *Dismiss*; answering in the terminal turns it *Running* |
| 5 | Let Claude finish its turn | *Waiting for your prompt* with the blue notice *Claude Code is waiting for you* on the strip once; the notice does not repeat until the session runs and stops again |
| 6 | Start `copilot` in another folder and give it a prompt | a second row with *CLI*, *Running* while the turn runs, *Waiting for your prompt* after it; no token count (the CLI reports none); the message count matches the turns in its own `/usage` within 2 % |
| 7 | `curl -i http://127.0.0.1:47391/health` | `200` with a one-line body; no token needed |
| 8 | `curl -i -X POST http://127.0.0.1:47391/hooks/generic -d '{"agent":"demo","sessionId":"1","status":"waiting","project":"demo","waitingKind":"input"}' -H "Content-Type: application/json"` without a token, then with the `Authorization: Bearer` header copied from Claude's settings file | `401` without the token; `200` with it and a *Coding agent · demo* row reading *Waiting for your prompt* plus the blue strip notice |
| 9 | Post the same document with `"status":"done"` | the row moves to *Recent* as *demo · Finished hh:mm · Coding agent*; *Dismiss* takes it out |
| 10 | Open the panel with two live sessions and one recent | header *2 active · 1 waiting*, *Refresh*; the waiting row first; *Recent* under the live rows; the list scrolls inside the panel with three or more rows |
| 11 | Hover a row | the row's background lifts; the row's accessible name is *Agent, project, status* |
| 12 | Press *Show* on a row | the agent's terminal window comes to the front; the panel stays open |
| 13 | Press *Dismiss* on a waiting row | the strip notice or pair for that session goes; the row stays until the session runs again |
| 14 | A project or task with a very long name | the project ends in an ellipsis before the chips wrap; the task and the command each end in an ellipsis on one line; the meta line never wraps |
| 15 | Close the terminal of a Claude session without `/exit` | after 30 minutes of silence the row moves to *Recent* (the hooks sent no `SessionEnd`) |
| 16 | Settings → *Watch coding agents* off, open the panel | *AI coding is off · Turn it on in Settings to see your coding agents here.* with *Open settings*; a hook post now gets `503`; the pane reads *Not listening* |
| 17 | Turn it back on with nothing running | *No agents running* with what starts one; without Claude hooks installed the body points at Settings with *Open settings* |
| 18 | Settings → *Port* → type `80` and press Tab | the field returns to the saved port; nothing is saved (privileged ports are refused) |
| 19 | Type `5005` and press Enter, then post to `/health` on both ports | *Listening on port 5005*, the hook URL follows, the old port refuses connections; Claude Code's file still names the old URL until *Install hooks* is pressed again |
| 20 | Start another program on the configured port, then toggle the module off and on | the pane reads *Listening on port N+1* — the next free port — and the hook URL follows |
| 21 | Hand-edit `settings.json` into invalid JSON and press *Install hooks* | the row reads *Claude Code's settings file could not be changed. Check that it is valid JSON and try again.*; the file is untouched |
| 22 | *Remove hooks* | the seven entries go and the `hooks` key is dropped when nothing else is in it; other hooks and settings are exactly as before |
| 23 | Dashboard card, one agent waiting and one running | *1 waiting · 1 running* in orange; the waiting project first; a wide card adds *Wants to run Bash* / the task |
| 24 | Windows *Animation effects* off | the panel appears without the enter spring; the strip's pair appears and goes without the reveal |
| 25 | Task Manager → Details, five minutes with the panel closed and no agent running | `muna.exe` idle CPU is unchanged with the module on (the receiver only waits on a socket; polls run on the 10 s idle cadence and read nothing) |
