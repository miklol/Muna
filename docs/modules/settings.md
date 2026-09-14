# Settings window

**Tier P0 · Owner: `muna-ui-engineer` · Status: spec**

## Purpose

Every behaviour in Muna is opt-in and tunable here. Mirrors MacNotch's dark, card-based
settings: left sidebar with search, one pane per module + system panes.

## Reference

`demo-23`, `window-snap` (settings window visible): sidebar 260 px with app identity + search
field + nav rows with icons; content cards radius 16, header row (icon · title · count chip ·
chevron), option tiles with check circles; title-bar pill "Muna Settings · Dark".

## Panes

General (language, launch at login, hide from captures, sounds, reduced motion, updates) ·
Layout (shape, size, module order, default module) · Multiple Screens (per-monitor cards) ·
Notch positioning (offsets, mode) · Live Activities · Drop Actions · Snap Zones · Shelf ·
Keyboard Shortcuts · Appearance (accent, wallpaper-adaptive tint) · Privacy & Permissions
(notification listener, location, camera) · Integrations (accounts: Microsoft, Google, GitHub,
GitLab, Bitbucket, Jira, Spotify, OpenAI/Ollama) · one pane per module · About & Updates ·
Diagnostics (export bundle, logs).

## Platform

Separate Tauri window, Mica backdrop when available (`DwmSetWindowAttribute
DWMWA_SYSTEMBACKDROP_TYPE`), system title bar hidden with custom pill. Settings persisted as
versioned JSON (`%APPDATA%\Muna\settings.json`) via a typed schema (zod) with migrations;
secrets in Windows Credential Manager (`CredWrite`).

## Acceptance criteria

- Search filters panes and individual settings by label and synonyms.
- Every toggle applies live (no relaunch) except language.
- Reset per pane and global; export/import settings JSON.
- Keyboard navigable; each control has a label; 4.5:1 text contrast in dark and light.
