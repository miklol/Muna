# Build plan · kickoff prompts

Paste-ready prompts for Copilot sessions or the custom agents in `.github/agents`. Each prompt
is self-contained: it names the agent, the docs to read, the deliverable, and the exit
criteria. Run them in order inside a milestone; epics inside a milestone can run in parallel
sessions (one branch each).

| Milestone | File | Epics |
| ----------- | ------ | ------- |
| M0 Foundations | [m0-foundations.md](m0-foundations.md) | Scaffold · Transparent-window spike · Identity spike · Tokens & presets |
| M1 Shell | [m1-shell.md](m1-shell.md) | Notch shell · Live activities · Settings · Panel chrome · Onboarding |
| M2 Media & HUD | [m2-media-hud.md](m2-media-hud.md) | Media backend · Media UI · HUD · Perf harness |
| M3 Daily modules | [m3-daily-modules.md](m3-daily-modules.md) | Calendar · To-do · Pomodoro · Weather · Notifications · Day progress · Bluetooth · System monitor · Dashboard |
| M4 Power tools | [m4-power-tools.md](m4-power-tools.md) | Drop actions · Shelf · Window snap · Code hosting · AI coding · Shortcuts · Notes · Screen time |
| M5 Ship | [m5-ship.md](m5-ship.md) | P2 modules · Fidelity pass · Accessibility · Release engineering · Site · Localization |

## How to run an epic

1. Create a session (worktree) from `main`; name it after the epic id (e.g. `m1-e1-notch-shell`).
2. Paste the prompt. Choose the agent named in the prompt (or `@muna-architect` when unsure).
3. The agent must finish with: all required checks green (never skipped or weakened — see
   [`../11-ci-cd.md`](../11-ci-cd.md#rules-for-agents)), a Conventional-Commit PR title,
   evidence (recording/numbers) in the PR, updated spec status, and an entry in the
   milestone's status table in [`../07-roadmap.md`](../07-roadmap.md).
4. Request `@muna-design-reviewer` on any PR touching UI; `@muna-qa-engineer` on any PR
   touching the shell, scheduler or a platform API. A human approves and merges (squash).

## Conventions every prompt assumes

- Repo rules: `.github/copilot-instructions.md`; CI/CD rules: `docs/11-ci-cd.md`.
- Stack and layout: `docs/03-architecture.md`; decisions: `docs/adr/`.
- Platform APIs: `docs/04-windows-platform-apis.md`.
- Design: `docs/05-design-system.md`; motion: `docs/06-motion-spec.md`.
- Module contract: `docs/adr/0004-module-contract.md`; spec template: `docs/modules/README.md`.
- Tests: `docs/09-testing-qa.md`.
