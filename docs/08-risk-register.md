# 08 · Risk register

Scored Likelihood × Impact (1–3 each). Owners are agent roles from `.github/agents`. Review at
every milestone close; add rows when a spike or incident reveals a new risk.

| # | Risk | L | I | Score | Mitigation | Trigger / early signal | Owner |
|---|------|---|---|-------|------------|------------------------|-------|
| R1 | Tauri transparent-window regressions (white flash on show #15490, Win10 black render #15947) | 3 | 3 | 9 | Never hide/show; park off-screen; `WEBVIEW2_DEFAULT_BACKGROUND_COLOR`; adopt `noRedirectionBitmap` when stable; **native D2D pill escape hatch** behind a flag | M0-E2 spike fails flash-free criterion | shell-engineer |
| R2 | No hover pass-through for click-through windows (#6164) → missed hovers or blocked clicks | 3 | 2 | 6 | Rust `GetCursorPos` hit-test with published shape rects; hit-test test suite; strip stays non-click-through | Users report clicks eaten under the notch | shell-engineer |
| R3 | `NotificationChanged` requires identity; external-location packaging may fail on some machines (policy, unsigned dev builds) | 3 | 2 | 6 | MSIX primary; external-location for NSIS; 1 s polling fallback always available; feature-flag at runtime | Identity spike failure; support tickets | release-engineer |
| R4 | Undocumented APIs (flyout suppression, `GetWindowBand`, `IPolicyConfig`, BT battery DEVPKEY, WNF) break on a Windows update | 2 | 2 | 4 | Isolate in `platform/undocumented`, feature flags, fail soft, watchdog restore, telemetry-free local error log | Insider build reports; CI on `windows-2025` runner | shell-engineer |
| R5 | Bluetooth connect via `BluetoothSetServiceState` leaves a service disabled after a crash → silent headset | 1 | 3 | 3 | Journal pending toggles in SQLite; re-enable on start and in `Drop`; UI confirmation | Any crash during connect | module-developer |
| R6 | Performance budget breach (RSS > 120 MB / idle CPU > 0.3 %) as modules accumulate | 2 | 3 | 6 | Nightly perf harness with hard fail; module lifecycle (`onVisible/onHidden`) enforced by lint; lazy-load module chunks; `SetProcessWorkingSetSize` after collapse | Perf trend line in CI | qa-engineer |
| R7 | Motion feels "web", not Apple (linear easings, fades instead of morphs, jank on 4K) | 2 | 3 | 6 | Presets only; design-reviewer gate on every visual PR; fps assertions; `layout` animations restricted to transform/opacity | Review findings tagged `fidelity` | motion-designer |
| R8 | Windows has no menu bar → notch overlaps title bars/tabs; users find it intrusive | 3 | 3 | 9 | Overlay yield rules + Reserved-strip mode; onboarding choice; per-app exclusion list; small default strip (32 px) | Uninstall feedback, issue volume | architect |
| R9 | Exclusive-fullscreen games hide the overlay or steal top-most | 3 | 1 | 3 | Detect and park; document; re-assert TOPMOST after foreground change | — | shell-engineer |
| R10 | Code signing eligibility/cost (Azure Artifact Signing regions, subscription) | 2 | 2 | 4 | Verify eligibility in M0; SignPath Foundation fallback; unsigned dev channel clearly labelled | Account rejection | release-engineer |
| R11 | Third-party API churn / quotas (Graph, Google Calendar verification, GitHub rate limits, LRCLIB, weather provider) | 2 | 2 | 4 | Adapter per provider, ETag/backoff, ICS zero-auth path, cached last-good state, provider health in Diagnostics | 4xx/429 spikes in local logs | module-developer |
| R12 | SMTC staleness / wrong session shown | 2 | 2 | 4 | Session scoring + WASAPI peak verification; periodic re-`RequestAsync`; 30-switch test script | QA script failures | module-developer |
| R13 | Copyright/trademark exposure from copying MacNotch assets or text | 1 | 3 | 3 | Paraphrase only; own icons/illustrations; no Apple/MacNotch marks in UI or site; reference screenshots stay out of the repo | Legal notice | docs-writer |
| R14 | Scope creep across 26 modules delays 1.0 | 3 | 2 | 6 | Tier discipline (P0–P2 only for 1.0); milestone exit criteria; cut list reviewed at each close | Milestone slips > 1 week | architect |
| R15 | WebView2 runtime missing/outdated on target machines | 1 | 2 | 2 | `downloadBootstrapper`; minimum-version check with friendly message; offline installer docs | Install failures | release-engineer |
| R16 | Accessibility gaps (screen readers with transparent overlay, focus stealing) | 2 | 2 | 4 | Names on all controls; `NOACTIVATE` discipline; Narrator smoke test in QA checklist | Narrator reads nothing on strip | qa-engineer |
| R17 | Multi-monitor/DPI edge cases (hot-plug, sleep/resume, projector duplicate mode) | 3 | 2 | 6 | Recreate windows on `WM_DISPLAYCHANGE`; per-monitor settings keyed by stable device id; test matrix | Crash/misplacement reports | shell-engineer |
| R18 | Tauri 3 migration cost if we adopt alpha features early | 2 | 2 | 4 | Stay on 2.x stable; isolate window creation behind `platform::window`; track PR #15410 backport | Breaking changes in alpha notes | architect |

## Assumptions log

- Windows 10 22H2 and Windows 11 are the only supported OS versions; ARM64 builds are
  best-effort until M5.
- Users accept a first-run explanation of why Muna wants Bluetooth/notification/webcam access.
- Free/open-source 1.0; licensing, telemetry and monetisation are out of scope for this plan.
- MacNotch screenshots are used as UI guidance only; no assets are copied.
