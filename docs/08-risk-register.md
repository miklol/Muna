# 08 · Risk register

Scored Likelihood × Impact (1–3 each). Owners are agent roles from `.github/agents`. Review at
every milestone close; add rows when a spike or incident reveals a new risk.

| # | Risk | L | I | Score | Mitigation | Trigger / early signal | Owner |
| --- | ------ | --- | --- | ------- | ------------ | ------------------------ | ------- |
| R1 | Tauri transparent-window regressions (white flash on show #15490, Win10 black render #15947) | 2 | 3 | 6 | Never hide/show; park off-screen; `WEBVIEW2_DEFAULT_BACKGROUND_COLOR`; adopt `noRedirectionBitmap` when stable; **native D2D pill escape hatch** behind a flag. M0-E2 passed flash-free on Win11 25H2 (0 flashes / 100 cycles + 22 monitor changes); Win10 22H2 run still open | Win10 22H2 run of [spikes/m0-window](spikes/m0-window.md) fails W1/W7 | shell-engineer |
| R2 | No hover pass-through for click-through windows (#6164) → missed hovers or blocked clicks | 3 | 2 | 6 | Rust `GetCursorPos` hit-test with published shape rects; hit-test test suite; strip stays non-click-through | Users report clicks eaten under the notch | shell-engineer |
| R3 | `NotificationChanged` requires identity; external-location packaging may fail on some machines (policy, unsigned dev builds) | 3 | 2 | 6 | MSIX primary; external-location for NSIS; 1 s polling fallback always available; feature-flag at runtime | Identity spike failure; support tickets | release-engineer |
| R4 | Undocumented APIs (flyout suppression, `GetWindowBand`, `IPolicyConfig`, BT battery DEVPKEY, WNF) break on a Windows update | 2 | 2 | 4 | Isolate in `platform/undocumented`, feature flags, fail soft, watchdog restore, telemetry-free local error log | Insider build reports; CI on `windows-2025` runner | shell-engineer |
| R5 | Bluetooth connect via `BluetoothSetServiceState` leaves a service disabled after a crash → silent headset | 1 | 3 | 3 | Journal pending toggles in SQLite; re-enable on start and in `Drop`; UI confirmation | Any crash during connect | module-developer |
| R6 | Performance budget breach (RSS > 120 MB / idle CPU > 0.3 %) as modules accumulate | 3 | 3 | 9 | Nightly perf harness with hard fail; module lifecycle (`onVisible/onHidden`) enforced by lint; lazy-load module chunks; `SetProcessWorkingSetSize` after collapse. **M0-E2 measured the WebView2 floor: 181–223 MB in the default process model (GPU process alone 66–117 MB on Intel iGPU), ≈ 100 MB with `--in-process-gpu` + one shared renderer; `muna.exe` is 10 MB of that.** Headroom for modules is ≈ 20 MB, so the harness must run per PR, not nightly only | Perf trend line in CI; `w4-w5-idle.json` over 110 MB | qa-engineer |
| R7 | Motion feels "web", not Apple (linear easings, fades instead of morphs, jank on 4K) | 2 | 3 | 6 | Presets only; design-reviewer gate on every visual PR; fps assertions; `layout` animations restricted to transform/opacity | Review findings tagged `fidelity` | motion-designer |
| R8 | Windows has no menu bar → notch overlaps title bars/tabs; users find it intrusive | 3 | 3 | 9 | Overlay yield rules + Reserved-strip mode; onboarding choice; per-app exclusion list; small default strip (32 px) | Uninstall feedback, issue volume | architect |
| R9 | Exclusive-fullscreen games hide the overlay or steal top-most | 3 | 1 | 3 | Detect and park; document; re-assert TOPMOST after foreground change (three-step assert: hook, +20 ms, +250 ms — a single assert lost every time in M0-E2); M1 follow-up for topmost windows shown without a foreground change | — | shell-engineer |
| R10 | Code signing eligibility/cost (Azure Artifact Signing regions, subscription) | 2 | 2 | 4 | Verify eligibility in M0; SignPath Foundation fallback; unsigned dev channel clearly labelled | Account rejection | release-engineer |
| R11 | Third-party API churn / quotas (Graph, Google Calendar verification, GitHub rate limits, LRCLIB, weather provider) | 2 | 2 | 4 | Adapter per provider, ETag/backoff, ICS zero-auth path, cached last-good state, provider health in Diagnostics | 4xx/429 spikes in local logs | module-developer |
| R12 | SMTC staleness / wrong session shown | 2 | 2 | 4 | Session scoring + WASAPI peak verification; periodic re-`RequestAsync`; 30-switch test script | QA script failures | module-developer |
| R13 | Copyright/trademark exposure from copying MacNotch assets or text | 1 | 3 | 3 | Paraphrase only; own icons/illustrations; no Apple/MacNotch marks in UI or site; reference screenshots stay out of the repo | Legal notice | docs-writer |
| R14 | Scope creep across 26 modules delays 1.0 | 3 | 2 | 6 | Tier discipline (P0–P2 only for 1.0); milestone exit criteria; cut list reviewed at each close | Milestone slips > 1 week | architect |
| R15 | WebView2 runtime missing/outdated on target machines | 1 | 2 | 2 | `downloadBootstrapper`; minimum-version check with friendly message; offline installer docs | Install failures | release-engineer |
| R16 | Accessibility gaps (screen readers with transparent overlay, focus stealing) | 2 | 2 | 4 | Names on all controls; `NOACTIVATE` discipline; Narrator smoke test in QA checklist | Narrator reads nothing on strip | qa-engineer |
| R17 | Multi-monitor/DPI edge cases (hot-plug, sleep/resume, projector duplicate mode) | 3 | 2 | 6 | Recreate windows on `WM_DISPLAYCHANGE`; per-monitor settings keyed by stable device id; test matrix | Crash/misplacement reports | shell-engineer |
| R18 | Tauri 3 migration cost if we adopt alpha features early | 2 | 2 | 4 | Stay on 2.x stable; isolate window creation behind `platform::window`; track PR #15410 backport | Breaking changes in alpha notes | architect |
| R19 | The W5 memory pass depends on Chromium switches (`--in-process-gpu`, `--process-per-site`, spare renderer off) that a WebView2 update may ignore; in-process GPU also turns a GPU-driver crash into a browser-process crash | 2 | 3 | 6 | Switches live in one place (`tauri.conf.json`, identical on every window); perf harness asserts no `--type=gpu-process` child and ≤ 120 MB; watchdog recreates windows on `ProcessFailed`; fallback decision documented in [spikes/m0-window](spikes/m0-window.md#recommendation) (evidence-based budget change or native strip with lazy WebView) | GPU-process child reappears after a runtime update; `w4-w5-idle.json` over budget | architect |
| R20 | The first launch of a new binary misses the 1.5 s cold-start budget (a cold file cache or Defender's scan of an executable it has not seen; not isolated yet), which is what every user sees right after an install or an update | 3 | 1 | 3 | The perf smoke launches once, straight after `cargo build`, so it measures exactly this case; report the first launch and the next launch as two numbers instead of one, then decide on the installed build whether the first-launch cost needs work (nothing in Muna's own startup path changed between the two launches) | `ci:app` breaches `startupMs` only on the launch after a build; a soak machine reports a slow first open after an update | qa |
| R21 | Layout regressions the test pyramid cannot see — jsdom has no layout, and panel stories rendered outside the shell's content-sized frame showed nothing wrong while the real panel drew a 0 px body | 2 | 2 | 4 | Panel stories render inside the desktop `PanelFrame` at the shell's size (since [#53](https://github.com/miklol/Muna/pull/53)) so the Storybook axe and visual runs see what the shell sees; modules declare their heights ([05-design-system → Panel body](05-design-system.md)); a fidelity audit of every surface at each milestone close; pixel checks belong to the nightly once the e2e harness lands | A module's panel or widget renders shorter than its story; a new panel is added without a `PanelFrame` story | design-reviewer |

## M5 close review (2026-09-28)

First milestone-close review of the table; the numbers come from the stack head (#56) and the
close-out's local `ci:app`. Table scores stay as they are until the two pieces of evidence that
could move them exist — the 14 nightly perf runs and the 7-day soak on three machines, both
the maintainer's (see [07-roadmap → M5](07-roadmap.md#m5--polish-p2-tail--10-4-weeks)). R20 and
R21 are new, from what the milestone measured and from what the fidelity audit found.

- **R1, R2, R8, R9, R17 (window strategy, hover pass-through, overlap, fullscreen,
  monitors).** No M5 epic touched the window strategy; the M1 yield checklist still stands at
  10 / 10 on Win11 and its Win10 22H2 column, the three-monitor desktop and the tablet are
  the soak's to log.
- **R3 (identity for `NotificationChanged`).** Unchanged since M3-E5: the unpackaged build
  polls at 1 s and the push column waits for the signed MSIX of E4.
- **R4 (undocumented APIs).** M5 added none: Mirror, Health, Translation and Support sit on
  documented WinRT and Win32 surfaces, and the M2 flyout suppression is still the only row
  behind a runtime probe.
- **R5 (Bluetooth service state).** Retired in effect: M3-E7 dropped `BluetoothSetServiceState`
  for `IOCTL_BTH_DISCONNECT_DEVICE` on the radio, so nothing is left in a disabled state after
  a crash. The row stays for the record.
- **R6 (performance budgets).** Still the top score, and still green at the head with every
  P0–P2 module registered: idle CPU 0.041–0.063 % normalised, private working set 37–45 MB
  after the idle trim (173–175 MB before it, 7 processes), cold start 716 ms on the second
  launch. The launch straight after the build measured 2124 ms against the 1500 ms budget —
  logged as R20 rather than as a budget breach because the next launch of the same binary
  passed with room and nothing in Muna's startup path differs between the two. The hard-fail
  nightly has not run once; that is the mitigation the table promises and the exit criterion
  the roadmap keeps open.
- **R7 (motion feels "web").** The fidelity audit ranked 2 blocking, 12 should and 10 nit
  findings across every surface and fixed the blocking and should items in the same PR
  (`paced()` joined the presets; segmented controls, tiles and cards now size to their
  content). The design-reviewer gate has now run against the whole app once; keep the score
  until the 4K and 165 Hz recordings of E4's release notes are in.
- **R10 (code signing).** The trigger has fired: there is no signed build at the M5 close.
  The I11 signing route has been carried since M0 and the 1.0 gate cannot close without it;
  everything that does not need a certificate (unsigned MSIX + NSIS, App Installer file, two
  SBOMs, update channel setting, check-only updater call) is built.
- **R11 (third-party API churn).** Translation adds two providers behind one adapter
  (OpenAI-compatible endpoints and Ollama) after Open-Meteo, ICS feeds and GitHub; its live
  run against a real endpoint is still a manual checklist row. No provider has changed shape
  during the plan.
- **R12 (SMTC staleness).** Unchanged since M2's 0 wrong picks in the 30-switch script.
- **R13 (copyright and trademark).** Held through the landing site: the hero notch is Muna's
  own primitives, the illustrations are ours, no Apple or MacNotch marks appear, and the
  catalog copy is checked against Muna's own feature catalog by a test. The screenshot gallery
  waits for the release engineer's own recordings.
- **R14 (scope creep).** The 1.0 scope is closed at P0–P2 with every module built; P3 stays
  off the site and out of the plan. Each module's *Deferred* list in `docs/modules` is the cut
  list.
- **R15 (WebView2 runtime).** `downloadBootstrapper` (silent) is configured and the Support
  bundle records the runtime version, but the minimum-version check with a friendly message is
  not built. Open; small; fits E4 or a 1.0.x.
- **R16 (accessibility).** E3 landed names on every control, 0 axe violations across 578
  stories, the *Increase contrast* and *Announce notices* switches, 44 px touch targets and
  `--text-3` at 4.6 : 1; the Narrator and contrast-theme rows of
  [qa/checklists/accessibility](qa/checklists/accessibility.md) are still manual, so the score
  stays.
- **R18 (Tauri 3).** On Tauri 2.11 stable; nothing from the 3.x alphas is in use.
- **R19 (Chromium switches).** The switches held through four milestones of runtime updates;
  the process count and the private working set above are within the W5 envelope. Unchanged.

## Assumptions log

- Windows 10 22H2 and Windows 11 are the only supported OS versions; ARM64 builds are
  best-effort until M5.
- Users accept a first-run explanation of why Muna wants Bluetooth/notification/webcam access.
- Free/open-source 1.0; licensing, telemetry and monetisation are out of scope for this plan.
- MacNotch screenshots are used as UI guidance only; no assets are copied.
