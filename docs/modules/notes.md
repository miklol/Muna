# Notes

**Tier P2 · Owner: `muna-module-developer` · Status: spec**

## Reference

`demo-12`, `demo-19`, `notes-feature-2`. Scratchpad list + editor; create/open from Dashboard.

## Behaviour

Local markdown files in `%APPDATA%\Muna\notes\` (user-changeable folder, works with Obsidian
vaults); list sorted by modified; quick capture hotkey appends to "Inbox"; pin notes; search;
plain textarea with light markdown preview toggle (no rich editor in v1).

## Acceptance criteria

- Notes survive restarts and are plain `.md` readable by other apps.
- Quick capture from any app in ≤ 200 ms (panel opens pinned with the cursor in the editor).
