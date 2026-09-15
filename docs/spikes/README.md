# Spikes

Time-boxed experiments that de-risk an ADR. `muna-architect` writes the plan (question, how to
run, environment table, exit criteria with budgets and methods, escape hatch); the implementing
agent fills in the measurements in the same file; the numbers then flip the ADR to *Accepted
(validated)* or amend it.

| Spike | Validates | Epic · agent | Status |
| ------- | ----------- | -------------- | -------- |
| [m0-window](m0-window.md) | [ADR-0001](../adr/0001-tech-stack.md), [ADR-0002](../adr/0002-window-strategy.md) | M0-E2 · `muna-shell-engineer` | Recorded (Win11 25H2 pass with the WebView2 switch amendment; Win10 22H2 open) |
| [m0-identity](m0-identity.md) | [ADR-0003](../adr/0003-packaging-identity.md) | M0-E3 · `muna-release-engineer` | Recorded (Win11 25H2: I1–I10 pass incl. the `release.yml` dry run, two amendments; I11 maintainer decision) |

## Rules

- Numbers, not adjectives: every criterion has a budget, a method and a measured value.
- Record the environment (OS build, monitors, GPU, WebView2 version, commit); results are not
  comparable otherwise.
- Raw artefacts (recordings, PDH logs, probe output) stay out of git; attach them to the PR.
- A failed criterion is a result, not a blocker: record it, run the escape hatch named in the
  plan, and let the ADR follow the numbers.
- Status: Planned → Running → Recorded. Once recorded, the ADR status changes; this file does
  not.
