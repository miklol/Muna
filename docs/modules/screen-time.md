# Screen Time

**Tier P2 · Owner: `muna-shell-engineer` + `muna-module-developer` · Status: spec**

## Reference
`screen-time-feature`, `-2`. Insights column (Avg / Longest session, Categories with dots +
durations, `Settings ›`), "Now" card (app icon + name + duration), donut (1h 50m today) +
stacked category bar + legend, App ranking bars. Header chips: total, switch count, layout toggle.

## Platform
`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` + `GetWindowThreadProcessId` →
`QueryFullProcessImageNameW`; idle via `GetLastInputInfo` (≥ 5 min pauses attribution); lock
via session notifications; browser tabs optional later via UI Automation (`UIA_NamePropertyId`
of the window title). Icons via `SHGetFileInfo`. SQLite `usage_sessions` (exe, start, end).
Categories: rule-based defaults + user overrides; excluded apps; day reset hour.

## Acceptance criteria
- Data never leaves the machine; export CSV.
- Attribution error ≤ 2 % vs. a manual log over a 1-hour test.
- Hook overhead ≤ 0.1 % CPU.
