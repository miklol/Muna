# M5 · Polish, P2 tail & 1.0

Read `docs/07-roadmap.md#m5--polish-p2-tail--10-4-weeks`. Requires M4 merged.

## M5-E1 · P2 modules — agent: `muna-module-developer`

Generic module prompt for `health` (manual + Windows Health/Google Fit import where feasible,
rings UI), `translation` (provider adapter: DeepL/LibreTranslate/Azure; clipboard quick
translate), `mirror` (`getUserMedia` in WebView2; stop tracks on collapse; flip/zoom), `support`
(help links, diagnostics, feedback form opening GitHub issue template).

## M5-E2 · Fidelity pass — agent: `muna-design-reviewer` then `muna-ui-engineer`

```text
Audit every surface (strip forms, notices, HUD, panel of each module, dashboard, settings,
onboarding) against docs/05-design-system.md, docs/06-motion-spec.md and the module's reference
screenshot notes in docs/reference/ui-observations.md. Produce docs/qa/fidelity-audit-<date>.md
ranked [blocking|should|nit]. Then a follow-up session fixes all blocking and should items.
```

## M5-E3 · Accessibility — agent: `muna-ui-engineer`

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

```text
Build apps/site (Vite + React, shares packages/ui tokens): hero with an interactive notch demo
(same components as the app), module catalog from docs/02-feature-catalog.md, downloads
(MSIX/NSIS with SmartScreen note), FAQ (title-bar overlap, fullscreen games, identity),
privacy (no telemetry). Own illustrations only; no third-party marketing text. Deploy to
GitHub Pages from release.yml.
```

## M5-E6 · Localization — agent: `muna-docs-writer`

```text
Set up i18next with ICU in packages/i18n; extract all strings; launch locales en, de, fr, es,
pt-BR (machine-draft + review notes); RTL smoke test with ar pseudo-locale; date/number
formatting via Intl with the user's Windows locale.
```

## 1.0 gate

All exit criteria in docs/07-roadmap.md#m5 checked, risk register reviewed, CHANGELOG written,
tag `v1.0.0`.
