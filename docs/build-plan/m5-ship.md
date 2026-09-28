# M5 · Polish, P2 tail & 1.0

Read `docs/07-roadmap.md#m5--polish-p2-tail--10-4-weeks`. Requires M4 merged.

## Plan (muna-architect, 2026-09-27)

M4 is built and stacked (#22 → … → #46), so M5 stacks on `m4-close-out` and merges after it,
for the same reason M4 stacked on M3: every epic here touches the registry, the settings model
and the shell that M4 changed. One PR per epic, phases A–E as before (platform → Rust module →
contract → UI → docs and PR), each passing `pnpm -w ci`, `ci:rust`, `ci:deps`, `ci:app` and
`docs:check` locally while the Actions budget is out. Two of the three exit criteria (14 days
of green nightly perf, the 7-day soak on three machines) and the whole of E4 need the
maintainer's machines, secrets and workflows; the plan builds everything that does not, and
leaves E4 a kickoff prompt rather than a branch.

### Progress

- **M5-E1a Support & diagnostics** — built on `m5-e1-support` (#47, base `m4-close-out`): the
  `SystemInfo` trait (Windows + fake), the support service with the Desktop bundle, the two
  repairs as calls on the HUD and the shell, the update channel and the check-only updater
  call, the panel and the pane. Deviations from the table below: `sysinfo` instead of
  `RtlGetVersion` (same build, plus the edition), and **no `Repair` trait** — the repairs are
  `HudService::repair_flyout` and `ShellManager::repair_app_bars`, wired in `ipc.rs`. Monitor
  topology is not in the bundle yet (it is in the logs); `crashReports` stays reserved. Spec:
  [modules/support](../modules/support.md); QA: [checklists/support](../qa/checklists/support.md).
- **M5-E1b Health** — built on `m5-e1b-health` ([#48](https://github.com/miklol/Muna/pull/48),
  base `m5-e1-support`): the pure tracker
  (sits, absences, lock and sleep, the interval with snooze, dismiss and the fullscreen
  deferral, the four flows, the hearing clock), the `health_days` store, the service with its
  30 s tick only while at the desk, the panel with the first **held (pinned) panel flows**
  through the shell's new `usePanelHold`, the widget and the pane. Deviations from the table
  below: a `breathePattern` setting (`'box' | 'relax'`), `clearHistory` as a seventh
  command, the flow activity at **64** and the notices at **44** (not 45) so a flow shows
  over playing media but under a starting event, the eye rest in-panel rather than an
  overlay, and the breaks goal derived from the interval. Spec:
  [modules/health](../modules/health.md); QA: [checklists/health](../qa/checklists/health.md).
- **M5-E1c Mirror** — built on `m5-e1c-mirror` ([#49](https://github.com/miklol/Muna/pull/49),
  base `m5-e1b-health`): the pure
  `PermissionPolicy` in `muna-platform` (camera for the app's own origin while the module is
  on, everything else denied, decisions not saved to the profile) behind WebView2's
  `PermissionRequested` on both webviews, `MirrorService` with `mirror_watch` →
  `Hold::MirrorPreview`, `useCameraStream` (opens on mount, stops on unmount, collapse,
  window hide and camera change, falls back from a missing camera, names the failures), the
  panel with the mirror chip, the zoom cycle and *Next camera*, the widget and the pane. The
  stories drive a painted canvas stream; no test or story opens a real camera. Deviations
  from the tables below: **no `WebviewPermissions` trait** (a function of the webview the
  shell already holds, nothing left to fake), and a `deviceLabel` beside `deviceId` so the
  pane can name the chosen camera. **Spike S1 is not yet observed**: the three manual rows
  (light on with the module on and no prompt, `NotAllowedError` with it off, light off within
  a second of a collapse) are rows 1–6 of the checklist and need the maintainer's machine.
  Spec: [modules/mirror](../modules/mirror.md); QA: [checklists/mirror](../qa/checklists/mirror.md).
- **M5-E1d Translation** — built on `m5-e1d-translation`
  ([#50](https://github.com/miklol/Muna/pull/50), base `m5-e1c-mirror`):
  the `Translator` trait with the `HttpTranslator` over the M4 `reqwest` client (SSE for
  OpenAI-compatible servers, NDJSON for Ollama, one `Decoder` per wire), `check_endpoint`
  (`https` anywhere, `http` only to a local or LAN host), the translate-only prompt with
  language names, the key in Credential Manager through `Secrets` under
  `translation.<provider>.key`, `TranslationService` with per-request cancel and a scripted
  spike S2, the panel that streams into a scrollable answer box with *Stop*, *Copy* through
  Rust and an inline language list, the widget, the pane and the `translation.translate`
  palette action. Deviations from the tables below: the provider enum is
  `TranslationProvider`, the chunk travels as `TranslationChunkEvent { chunk }`, two more
  errors (`endpoint`, `vault`), a `TranslationChanged` event with a snapshot
  (`get_translation_snapshot`: effective endpoint and model, `hasKey`, `needsKey`, `active`),
  and a `translation_copy(text)` command so the webview never touches the clipboard. **Spike
  S2's live run is not yet observed**: the scripted half passes in `tests/translation.rs`; the
  run against LM Studio or Ollama is rows 1–4 of the checklist. Dictation and the
  clipboard hotkey stay deferred. The shared Storybook preview gained an `afterEach` that
  waits for Motion's WAAPI enter transitions before the a11y audit (the runner pauses CSS
  animations only), which the panel's enabled primary button exposed. Spec:
  [modules/translation](../modules/translation.md); QA:
  [checklists/translation](../qa/checklists/translation.md).
- **M5-E6 Localization** — built on `m5-e6-localization`
  ([#51](https://github.com/miklol/Muna/pull/51), base `m5-e1d-translation`):
  `@muna/i18n` grew a locale registry (`SUPPORTED_LOCALES`, `resolveCatalogLocale`,
  `resolveFormatLocale`, `localeStatus`, `localeDisplayName`) and strips `_`-prefixed notes
  from the catalogs; the `ar-XB` pseudo-locale is generated from `en` at runtime (spike S3);
  Rust reads the Windows regional format (`GetUserDefaultLocaleName`, on `SystemInfo`, faked
  as `en-US`) into `AppInfo.regionFormat` and settings v6 adds `general.language`; the desktop
  app resolves one setting into the catalog i18next speaks and the tag every `Intl` call
  takes (`useLocale()`, swept across every formatter), mirrors the spoken language onto `<html
  lang dir>`, and shows language tiles on the General pane named in their own language, drafts
  labelled as such; both Storybooks gained a *Language* toolbar and four `PseudoRtl` stories.
  The four catalogs (de, fr, es, pt-BR; 1574 messages each) are machine drafts with a `_review`
  note per section, written to one voice and one terminology table per language, and
  `i18n:check` now holds every locale to the English key set, the placeholders, the notes and
  "no copied English" (with two documented allowlists). Deviations from the table below and
  the kickoff: **i18next's own `{{name}}` interpolation and CLDR plural suffixes, not ICU**
  (`03-architecture.md` corrected); a chosen language formats in that language while `system`
  follows the Windows regional format, so the two can differ only under `system`; nothing on
  the landing site is translated yet. Doc: [localization](../localization.md); QA:
  [checklists/localization](../qa/checklists/localization.md) (rows 1–9 need a Windows
  Settings pass on the maintainer's machine).
- **M5-E3 Accessibility** — built on `m5-e3-accessibility`
  ([#52](https://github.com/miklol/Muna/pull/52), base `m5-e6-localization`): settings v7
  adds `general.contrast` and `general.announceNotices` (Settings → Appearance →
  *Accessibility*; both follow Windows and stay quiet by default),
  mirrored as `data-contrast` on `<html>` and as the strip's `aria-live` (`off` → `polite`);
  `--size-hit-effective` is 44 px under `(pointer: coarse)` and the four controls that were
  only as tall as they look (toggle, checkbox, chip, segmented control) extend their hit area
  in the block direction, while raw `:hover` tints sit behind `(hover: hover)`; every panel and
  pane has a story file with a `PseudoRtl` variant (desktop 361 stories, ui 217, 0 axe
  violations), and what the new stories found was fixed in the design system rather than
  per story — `Card.headingLevel` and module sub-headings at `h2` under the panel's `h1`, the
  weather chance as an `aria-hidden` figure beside a `.sr-only` sentence instead of an
  `aria-label` on a span, the calendar agenda as a labelled tab stop, `--text-destructive` for
  red text (`--accent-red` is 4.26:1 on a hovered row), and the M0-E4 known gap closed by
  raising `--text-3` to 46 % (4.6:1; light 55 %) so the last axe opt-out is gone. Deviations
  from the kickoff: touch targets stay 28 px visual and grow the *hit* area to 44 px, as the
  design system already said; announcements are opt-in (the kickoff said so) and there is no
  per-second throttle beyond `polite`; the reduced-motion audit found the presets already
  carry fallbacks, so it added stories rather than code. Doc:
  [05-design-system → Accessibility](../05-design-system.md#accessibility); QA:
  [checklists/accessibility](../qa/checklists/accessibility.md) (rows 1–19 need Narrator, a
  contrast theme and a touch screen on the maintainer's machine).
- **M5-E2 Fidelity pass** — built on `m5-e2-fidelity`
  ([#53](https://github.com/miklol/Muna/pull/53), base `m5-e3-accessibility`): the
  [audit](../qa/fidelity-audit-2026-09-28.md) (mechanical sweeps,
  Storybook contact sheets and probes, the running app) ranked 2 blocking, 12 should and 10
  nit findings, then found 6 more while fixing. What it turned up was one class of defect:
  the shell sizes a panel to its content (190–360), so every module that relied on the body
  being 284 px — `flex: 1 1 0` rows, `block-size: 100%` boxes, lists with no bound — got
  nothing (the dashboard's grid was 0 px tall in every build) or grew past the maximum and
  was clipped. Modules now declare their heights (dashboard rows, mirror frame, translation
  boxes, list bounds in code hosting, AI coding, notes, shelf, support), auto-fit their tiles
  and cards at the 720 px minimum width (system monitor, health, weather), and the desktop
  `PanelFrame` renders every panel story at that width with the shell's clamp, so the
  Storybook axe run catches the class from now on. Also: segmented controls size to the
  widest label (`inline-grid`), `paced()` in `@muna/ui/motion` for content-paced tweens,
  radius / scrim / caption tokens where literals were, `-webkit-font-smoothing` and four
  `will-change` hints gone, *Open settings* / *in Settings* copy in five catalogs. Deviations
  from the kickoff: one session did both halves; the audit's mirror figure (240 max) became an
  explicit 236 px frame. Doc: [05 › Spacing & sizing](../05-design-system.md#spacing--sizing)
  (the *Panel body* row), [06 › Timings](../06-motion-spec.md#timings-non-spring) (*Paced
  content*), each module doc's height budget.
- **M5-E5 Landing site** — built on `m5-e5-site`
  ([#56](https://github.com/miklol/Muna/pull/56), base `m5-e2-fidelity`):
  `apps/site` is one static page (Vite, `base: './'` so the same build serves a project page,
  a custom domain and `vite preview`; plain CSS over the `@muna/ui` tokens, no Tailwind) with
  a hero whose notch is the app's own `NotchSurface`, `StripView`, `PanelChrome` and
  `ModuleBar` driven by the shell's hover choreography (hover intent → reveal → rest → open,
  grace on leave, pin, Escape, keyboard focus handoff) and the motion presets — the demo
  pauses its live pieces when scrolled out of view or the tab is hidden and scales below
  760 px; a module catalog generated from `src/content/catalog.ts`, which a test parses
  against [02-feature-catalog](../02-feature-catalog.md) (ids, names and tiers must match,
  summaries must be the site's own, P3 rows are hidden); downloads (MSIX recommended, NSIS,
  requirements, the SmartScreen note, how updates arrive); an eight-question FAQ; the
  privacy section. Own artwork only (favicon, wordmark, a fictional album cover); no third-
  party marks; English only by design. Deviations from the kickoff: the deploy is not wired —
  agents do not add workflows, so the `site.yml` of
  [11-ci-cd → Workflows](../11-ci-cd.md#workflows) (build `pnpm --filter @muna/site build`,
  publish `apps/site/dist` to Pages) is the maintainer's; there is no screenshot gallery yet
  because the polished surfaces are best shown by the live demo and the release engineer's
  recordings.

### Order

| # | Epic | Why here | Depends on |
| --- | ------ | ---------- | ------------ |
| 1 | M5-E1a Support & diagnostics | Smallest; the diagnostics bundle and the repair buttons are what the soak (exit criterion 2) needs on a machine that misbehaves; the update-channel setting is the hook E4 wires | — |
| 2 | M5-E1b Health | Local only; reuses `Foreground::idle_for` (M4-E8) and the HUD's level events; its guided flows are the first pinned panel flows, so they settle the pattern before Translation streams into one | — |
| 3 | M5-E1c Mirror | Spike S1 (camera permission in WebView2) first; the smallest UI once the permission path exists | S1 |
| 4 | M5-E1d Translation | The second network integration after code hosting; key in Credential Manager through the M3 `Secrets` trait; streaming; dictation deferred | S2 |
| 5 | M5-E6 Localization | The string set is only frozen once the last module exists; language setting, `Intl` through the chosen locale, an RTL pseudo-locale smoke, the four machine drafts with review notes | E1 |
| 6 | M5-E3 Accessibility | Audits every surface once, after the last module and the locale plumbing (names and live regions are strings too) | E1, E6 |
| 7 | M5-E2 Fidelity pass | After accessibility so the two sets of fixes do not fight over the same components | E3 |
| 8 | M5-E5 Landing site | Needs the final catalog and screenshots of the polished surfaces | E2 |
| — | M5-E4 Release engineering | `muna-release-engineer` with the maintainer's secrets, on `main`, off this stack; nothing here edits `release.yml`, `scripts/msix/` or `release-please-config.json` | — |

### Cross-cutting contract changes (additive)

- **Support**: `settings.modules.support = { channel: 'stable' | 'beta', crashReports: false }`
  (`crashReports` is reserved and stays `false`; no reporter ships); commands
  `get_support_snapshot` (version, channel, WebView2 and OS versions, profile folder, the
  repair states), `support_command({ kind: 'diagnostics' | 'repairFlyouts' | 'repairAppBar' |
  'openLogs' | 'checkUpdates' })` returning the bundle path for `diagnostics`, `support_open({
  target: 'help' | 'feedback' | 'rate' | 'releaseNotes' })` building the URL in Rust; event
  `SupportChanged`.
- **Health**: `settings.modules.health = { enabled, breakEveryMin (50), waterGoal (8),
  windDownHour?, hearingWarning, breathePattern ('box') }`; `get_health_snapshot` (sitting
  since, today's counters, weekday dots, the running flow), `health_command({ kind:
  'startFlow' | 'stopFlow' | 'water' | 'snooze' | 'dismiss' | 'reset' | 'clearHistory' })`,
  `HealthChanged`; strip content `health:break` notice (44) and `health:flow` activity (timer
  glyph, priority 64) while a flow runs. *As built in E1b; the plan said priority 45 and no
  `breathePattern` or `clearHistory`.*
- **Mirror**: `settings.modules.mirror = { enabled: false, flip: true, deviceId: null,
  deviceLabel: null }`; no snapshot — the panel calls `getUserMedia` itself; Rust only decides
  the permission (below) and exposes `mirror_watch(watching)` so the shell can lift the low
  memory target while the preview runs. Streams stop on collapse, unmount and window hide.
  *As built in E1c; the plan had no `deviceLabel`.*
- **Translation**: `settings.modules.translation = { enabled: false, provider: 'openai' |
  'ollama', endpoint, model, source: 'auto' | tag, target: tag }`; commands
  `translation_set_key(key)` / `translation_clear_key()` (Credential Manager, entry
  `translation.<provider>.key`), `translate({ text, source, target }) -> requestId`,
  `translation_cancel(requestId)`; event `TranslationChunk { requestId, text, done, error? }`.
  The consent line names the endpoint before the first request. *As built in E1d: the event
  is `TranslationChunkEvent { chunk }`, plus `get_translation_snapshot()`,
  `TranslationChanged { snapshot }` and `translation_copy(text)`; the plan had no snapshot.*
- **General**: `settings.general.language: 'system' | string` (a BCP-47 tag from the bundled
  set); the UI creates i18next with it and passes the same tag to every `Intl` formatter.
- Every new type gets a zod schema in `packages/contracts/src/schemas.ts` and a round-trip
  test; bindings regenerate with `--export-bindings`.

### Platform traits (new in `muna-platform`, all scripted in `FakePlatform`)

| Trait | Windows implementation | Epic |
| ------- | ------------------------ | ------ |
| `SystemInfo` | **Built (E1a)**: `sysinfo` for the OS edition and build (`RtlGetVersion` gives the build without the edition), `GetAvailableCoreWebView2BrowserVersionString` for WebView2, `SHGetKnownFolderPath(FOLDERID_Desktop)` for the bundle's folder; the log size comes from the module, monitors from the shell's startup log | E1a |
| ~~`Repair`~~ | **Not built as a trait (E1a)**: the two repairs are calls on services the shell already owns — `HudService::repair_flyout` (clear the suppression cache, show Windows's flyouts, apply the setting again) and `ShellManager::repair_app_bars` (release every app bar, reconcile) — so there was nothing platform-specific left to abstract | E1a |
| ~~`WebviewPermissions`~~ | **Not built as a trait (E1c)**: `PermissionPolicy` (pure, in `muna-platform::permissions`) answers `ICoreWebView2::add_PermissionRequested` next to `set_memory_usage_target` in `windows/webview.rs` — camera for the app's own origin while `mirror.enabled`, everything else denied without a prompt, nothing saved to the profile; the shell installs it on both webviews. Like the memory target it is a function of the webview the shell already holds, so there was nothing to fake | E1c |
| ~~`Http` streaming~~ | **Not built as a trait (E1d)**: the `Translator` trait lives in the module (`modules/translation/provider.rs`) with `HttpTranslator` over the M4 `reqwest` client — SSE and NDJSON `Decoder`s, `check_endpoint`, and cancel by dropping the request from the service's active set so the next `deliver` stops the read loop — plus a scripted translator in `tests/translation.rs`; nothing else streams, so nothing platform-wide was abstracted | E1d |
| `Speech` | `Windows.Media.SpeechRecognition` — **deferred**; the mic button is not built in M5 | — |

### Spikes with exit criteria

- **S1 Camera permission in WebView2** (before E1c phase A): with mirror on,
  `getUserMedia({ video: true })` in the notch webview resolves without a prompt and the
  camera light comes on; with mirror off it rejects with `NotAllowedError`; stopping the tracks
  on collapse turns the light off within a second. Exit: the three observations logged in a
  manual run; otherwise the module ships panel-only with the permission granted at the
  settings window and the widget deferred. *Record (E1c): the handler and the policy are
  built and unit-tested against the `webview2-com` surface (`PermissionRequested`, `SetState`,
  `SetSavesInProfile`), and the module ships with both the panel and the widget; the three
  observations themselves are rows 1–6 of
  [checklists/mirror](../qa/checklists/mirror.md) and are still to be logged on a machine
  with a camera — the agent session that built E1c never opened one.*
- **S2 Streaming with cancel** (before E1d): a fake provider in `tests/translation.rs` streams
  five chunks and a cancel after the second leaves no further `TranslationChunk`; live against
  LM Studio or Ollama on the maintainer's machine. Exit: the test and one manual run. *Record
  (E1d): the scripted half passes — `spike_s2_a_cancel_after_the_second_piece_leaves_no_further_chunk`
  and the decoder suites in `tests/translation.rs`; the live run is rows 1–4 of
  [checklists/translation](../qa/checklists/translation.md) and still needs a machine with a
  local model — the agent session that built E1d had no provider to talk to.*
- **S3 RTL pseudo-locale** (E6): an `ar` pseudo-locale (mirrored English) renders the existing
  RTL stories without clipping or LTR punctuation leaks. Exit: the Storybook run with zero
  axe violations; findings become E3 rows. *Record (E6): built as `ar-XB` — English wrapped in
  a right-to-left override, generated from `en` at runtime, reachable by name from the
  Storybook Language toolbar and never from the settings tiles; `applyDocumentLocale` flips
  `<html dir>` from i18next's answer. Four `PseudoRtl` stories (the command palette, the
  General pane, the notes and translation panels) pass axe in `storybook:ci`. The visual walk
  is rows 10–18 of [checklists/localization](../qa/checklists/localization.md); its layout
  findings (physical properties, unmirrored glyphs) are E3's, and E3 added a `PseudoRtl` story
  to every panel and pane — 0 axe violations across both Storybooks.*

### Risks

- Actions budget: still nothing merges; every PR body records its parity results.
- Camera privacy: no access until the user turns mirror on; the OS indicator is the proof, and
  the pane says so. Never capture frames on the Rust side.
- Translation sends text to a third party: the endpoint is named on the consent line and in
  the pane; the key never leaves Credential Manager; nothing is logged but the chunk count.
- Machine-drafted locales: every drafted file carries a `_review` note per section and the
  language switcher labels them *draft*; en stays the source of truth. *As built (E6): the
  tiles read "Machine draft, not yet reviewed by a native speaker"; `i18n:check` fails on a
  missing note and on copied English; the voice and terminology per language are recorded in
  [localization](../localization.md) for the reviewer.*
- High contrast: `[data-contrast=more]` shifts tokens on the black-glass material; audit the
  strip's glyph-on-glass contrast before changing any material value.
- Narrator: names and roles are testable; the actual reading order is a manual pass on the
  maintainer's machine, recorded in `docs/qa/checklists/accessibility.md`.

### Test plan

Fake-platform Rust suites per module (`tests/<module>.rs`), Vitest for reducers, panels and
panes, contract round-trips, `ci:app` after every epic (all P1 and P2 modules on), `i18n:check`
extended to every locale (same key set as `en`, placeholders kept, a `_review` note per
section, no copied English — as built in E6), axe in both Storybooks for every new story, and
the QA checklists `docs/qa/checklists/{support,health,mirror,translation,localization,
accessibility}.md` for the manual rows.

## M5-E1 · P2 modules — agent: `muna-module-developer`

Generic module prompt for `health` (manual + Windows Health/Google Fit import where feasible,
rings UI), `translation` (provider adapter: DeepL/LibreTranslate/Azure; clipboard quick
translate), `mirror` (`getUserMedia` in WebView2; stop tracks on collapse; flip/zoom), `support`
(help links, diagnostics, feedback form opening GitHub issue template).

## M5-E2 · Fidelity pass — agent: `muna-design-reviewer` then `muna-ui-engineer`

*Built — see [Progress](#progress). The audit, its decisions and the panel-height contract it
clarified are in [qa/fidelity-audit-2026-09-28](../qa/fidelity-audit-2026-09-28.md).*

```text
Audit every surface (strip forms, notices, HUD, panel of each module, dashboard, settings,
onboarding) against docs/05-design-system.md, docs/06-motion-spec.md and the module's reference
screenshot notes in docs/reference/ui-observations.md. Produce docs/qa/fidelity-audit-<date>.md
ranked [blocking|should|nit]. Then a follow-up session fixes all blocking and should items.
```

## M5-E3 · Accessibility — agent: `muna-ui-engineer`

*Built — see [Progress](#progress). The audit table, the decisions and the manual rows are in
the PR and in [checklists/accessibility](../qa/checklists/accessibility.md).*

```text
Make Muna usable with keyboard and Narrator: names/roles on all controls, focus order, visible
focus ring token, Esc semantics, live-region announcements for notices (opt-in), high-contrast
theme via [data-contrast=more], reduced-motion audit (every preset has a fallback), touch
targets ≥ 28 px with 44 px hit area. Add axe checks to Storybook test-runner. Document in
docs/qa/checklists/accessibility.md.
```

## M5-E4 · Release engineering — agent: `muna-release-engineer`

```text
Finish docs/10-release-distribution.md: release.yml producing signed MSIX + NSIS (external-
location identity), minisign updater artifacts and latest.json, .appinstaller feed, GitHub
Release with release-please notes, version propagation script, upgrade tests (previous → new)
in CI, uninstall verification (OSD restored, AppBar removed). Dry-run a v0.9.0-beta.1.
```

## M5-E5 · Landing site — agent: `muna-ui-engineer` + `muna-docs-writer`

*Built — see [Progress](#progress). The kickoff below said "deploy from release.yml"; the
build only produces `apps/site/dist`, and the Pages workflow is the maintainer's to add.*

```text
Build apps/site (Vite + React, shares packages/ui tokens): hero with an interactive notch demo
(same components as the app), module catalog from docs/02-feature-catalog.md, downloads
(MSIX/NSIS with SmartScreen note), FAQ (title-bar overlap, fullscreen games, identity),
privacy (no telemetry). Own illustrations only; no third-party marketing text. Deploy to
GitHub Pages from release.yml.
```

## M5-E6 · Localization — agent: `muna-docs-writer`

*Built — see [Progress](#progress). The kickoff below asked for ICU; the build kept i18next's
own interpolation, and [localization](../localization.md) is the reference.*

```text
Set up i18next with ICU in packages/i18n; extract all strings; launch locales en, de, fr, es,
pt-BR (machine-draft + review notes); RTL smoke test with ar pseudo-locale; date/number
formatting via Intl with the user's Windows locale.
```

## Stack and merge order

Every agent-buildable M5 epic landed as one PR stacked on the previous one, on the M4
close-out because nothing has merged since M1:

| PR | Epic | Base |
| --- | ------ | ------ |
| [#47](https://github.com/miklol/Muna/pull/47) | M5-E1a Support & diagnostics | `m4-close-out` (#46) |
| [#48](https://github.com/miklol/Muna/pull/48) | M5-E1b Health | #47 |
| [#49](https://github.com/miklol/Muna/pull/49) | M5-E1c Mirror | #48 |
| [#50](https://github.com/miklol/Muna/pull/50) | M5-E1d Translation | #49 |
| [#51](https://github.com/miklol/Muna/pull/51) | M5-E6 Localization | #50 |
| [#52](https://github.com/miklol/Muna/pull/52) | M5-E3 Accessibility | #51 |
| [#53](https://github.com/miklol/Muna/pull/53) | M5-E2 Fidelity pass | #52 |
| [#56](https://github.com/miklol/Muna/pull/56) | M5-E5 Landing site | #53 |
| [#57](https://github.com/miklol/Muna/pull/57) | M5 close-out (this document, the roadmap, the risk register) | #56 |
| [#58](https://github.com/miklol/Muna/pull/58) | `scripts/land-stack.ps1` and the landing procedure below | #57 |

Merge from the bottom of the M2 stack upwards (#22 → … → #46 → #47 → … → #56 → #57 → #58)
with `scripts/land-stack.ps1`: it squash-merges one PR with the title as the
subject, retargets its child to `main`, deletes the parent's branch, rebases only the child's
own commits onto `main` in a scratch worktree, force-pushes it with a lease and waits for the
child's checks before the next merge. The rebase is not optional: a squash rewrites the
parent's history, so a child that is merely retargeted still carries the parent's commits and
GitHub shows them as conflicts — the landing simulation of 2026-09-28 (`land-stack.ps1
-Simulate`) merged #24 onto a squashed #22 without the rebase and hit 11 conflicted files,
then replayed all 33 PRs with the rebase: every one clean, no PR branched from anything but
its parent's final tip, and the simulated `main` ended with exactly the tree of #57. The live
landing started the same day once the repository went public (the private plan's Actions
budget and artifact-storage quota had held every hosted run; see below): #22 merged as
`71c258c`, #24 rebased, passed its checks in four minutes and merged, and the script then
stopped on #25 with conflicts in exactly #24's files. Cause: it read the child's merge base
from `origin/<parent>` *after* it had force-pushed the parent's rebased commits there, so the
base fell back to the old `main` and the rebase replayed #22 and #24 again — a path the
simulation could not reach because it never pushes. The fix (in #58) snapshots every branch
tip at start-up and measures each PR's own commits against the parent's original tip; the
recovery flag `-RebaseOnto` reads that tip from the parent PR's last force-push event. The
simulation re-run from #25 with `-RebaseOnto 24`: 32 clean rebases (#25 replaying its 2 own
commits, not 4) and a simulated `main` equal to the tree of #58. The relaunched landing merged
PRs #25 and #26 and stopped on #27, the perf-harness PR itself, whose `app` check failed the
cold-start gate: the debug build started in 1976 ms on the 4-vCPU `windows-latest` runner
against the PRD's 1500 ms, and after the two-launch fix (risk R20; first launch 3814 ms
reported, relaunch gated) the same binary measured 1474 ms on the next run — a 25 % swing on
identical code. The harness now dates the WebView2 browser process and the first renderer from
the process tree: of the 1474 ms, 668 ms passed before the browser process existed (the app's
own start-up: bindings export, platform watchers, profile, plugins, window), 276 ms were
Chromium's boot and 530 ms the page on software rendering; optimising the dev profile's
dependencies moved the app's share by about 7 %, so the gate as specified measures the runner.
The decision is the maintainer's (docs/11 forbids narrowing a check from a PR): #59 (draft,
based on #27) proposes gating the start-up row on release builds and reporting it for debug
builds, the rule `bundle:check` already applies to the exe size, with a release-candidate check
by hand until a job builds a release binary; the alternatives — a release or `perf`-profile
build in the `app` job, or a larger runner — need a workflow edit. The landing resumes from
PR #27 once one of them is in place. Every PR passes the parity
commands locally (`pnpm -w ci`, `ci:rust`, `ci:deps`, `ci:app`, the docs checks); until the
repository went public the hosted checks had not run because the GitHub Actions budget was
exhausted ("The job was not started because an Actions budget is preventing further use" on
every job, #57 included). The script reruns each never-started run once and stops on anything
else; each PR's rebase push starts its own run, so the landing costs one full CI run per PR
(about 35). `#54` and `#55` are Dependabot's and independent — #55 touches every
`package.json` and `pnpm-lock.yaml` the stack also changes, so land the stack first and let
Dependabot rebase.

What the milestone's own passes caught that the unit suites could not, for the record: the
fidelity audit found that the shell sizes a panel to its content, so every module that assumed
a 284 px body (`flex: 1 1 0` rows, `block-size: 100%`, unbounded lists) rendered 0 px tall or
clipped — the dashboard's grid had been 0 px in every build (#53, with the desktop `PanelFrame`
so the Storybook axe run catches the class from now on); the accessibility audit raised
`--text-3` to 4.6:1 and found the 44 px touch targets missing (#52); the RTL walk of the
`ar-XB` pseudo-locale found physical properties and unmirrored glyphs (#51 → #52); the site's
catalog test found no drift, which is the point of having it (#56).

Carry-overs (listed against the M5 exit criteria in
[07-roadmap → M5](../07-roadmap.md#m5--polish-p2-tail--10-4-weeks)): the whole of **E4** with
the maintainer's secrets and workflows (signing route I11 since M0, the updater feed,
`site.yml` for the Pages deploy); the 14-day nightly perf window and the 7-day soak on three
machines, which need the budget and the hardware; the manual rows of the six M5 checklists
(mirror's spike S1 light-on / light-off rows, translation's live run against a real endpoint,
the Windows Settings language pass, Narrator and the contrast themes on a touch screen);
native-speaker review of the four machine-drafted locales; a screenshot gallery on the site
once the release engineer records the polished surfaces; the Windows 10 columns of every
checklist; the perf smoke's first-launch reading (2124 ms straight after a build, 716 ms on
the next launch — risk R20, for QA to split into two reported numbers rather than one); the
WebView2 minimum-version message of risk R15; and the M0–M4 carry-overs that still stand.

## 1.0 gate

All exit criteria in docs/07-roadmap.md#m5 checked, risk register reviewed, CHANGELOG written,
tag `v1.0.0`.

*Status at the close-out (2026-09-28):* every P0–P2 module of the
[feature catalog](../02-feature-catalog.md) is built, documented and stacked; the
[risk register](../08-risk-register.md#m5-close-review-2026-09-28) carries its milestone-close
review; the three exit criteria are annotated in the roadmap with what is built and what
waits for the maintainer. The `CHANGELOG.md` is release-please's once `RELEASE_AUTOMATION` is
on, and the tag follows the E4 dry run, so the gate itself is the maintainer's to close.
