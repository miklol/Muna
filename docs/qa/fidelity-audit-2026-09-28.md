# Fidelity audit — 2026-09-28 (M5-E2)

Every surface against [05-design-system](../05-design-system.md),
[06-motion-spec](../06-motion-spec.md) and
[reference/ui-observations](../reference/ui-observations.md), as the M5-E2 kickoff in
[build-plan/m5-ship.md](../build-plan/m5-ship.md#m5-e2--fidelity-pass--agent-muna-design-reviewer-then-muna-ui-engineer)
asks. Findings are ranked
*blocking* (the surface is wrong or unreadable), *should* (visibly off-spec) and *nit* (a token
or copy detail nobody would notice). Blocking and should items are fixed in the same PR; the
decision column says how. Nits are fixed where the fix is a one-liner and otherwise recorded
as accepted deviations.

## Method

- **Mechanical sweeps** over `apps/desktop/src` and `packages/ui/src` (motion, tokens, stories
  and tests excluded): literal durations, easings, stiffness and damping; literal colours,
  radii, font sizes and weights; `text-transform: uppercase`; `box-shadow`, `filter: blur`,
  `will-change`; `@keyframes` and infinite repeats; the English catalog for exclamation marks,
  title case and jargon.
- **Storybook contact sheets** at device scale factor 1 from the static builds (`@muna/ui`
  and `@muna/desktop`): every strip form, the three surface states, the panel chrome, the
  module bar, every module panel in every state, the command palette, the drop row, the snap
  zones, every settings pane and the welcome tour. The desktop `PanelFrame` decorator used
  to render panels at 420 × 320; it now renders them at the shell's minimum panel width
  (720) with the panel's natural height clamped to 190–360, exactly as `NotchWindow` sizes
  them, which is what surfaced the height findings below.
- **Probes** over the same stories: natural panel height, elements that scroll or clip
  (`scrollHeight > clientHeight`), ellipsised labels (`text-overflow: ellipsis` in effect).
- **The running app**: the debug build with a private profile, the notch expanded with the
  real cursor (`scripts/perf/harness.mjs`), every module opened through the module bar and the
  panel + bar captured on a 2560 × 1440 monitor at 150 % (panel 1000 × 190–360).

Surfaces reviewed: 22 strip forms and HUD, notch surface (strip, panel, island), panel chrome,
module bar, waveform; 19 module panels in 129 stories plus all 19 in the running app; command
palette, drop row, snap zones; six settings panes, the module settings panes, the welcome
tour.

## Findings

### Blocking

| # | Surface | Finding | Spec | Decision |
| --- | --- | --- | --- | --- |
| B1 | Dashboard panel | The 2 × 4 grid collapses to 0 px and all seven cards overlap — in every story and in the running app (`grid 930 × 0`). `.dashboard__grid` is `flex: 1 1 0; min-block-size: 0` with `1fr` rows, so it needs a definite parent height; the shell sizes the panel to its content (`.muna-panel { block-size: 100% }` resolves to `auto` inside the measured wrapper), so there is none. [dashboard.md](../modules/dashboard.md) assumes "the panel body is 284 px tall". | Panel height follows content, 190–360 ([05 › Spacing & sizing](../05-design-system.md#spacing--sizing)) | Modules own their height. The grid gets two explicit 120 px rows (`--dashboard-row`), so the panel measures 360 with any content; `dashboard.md` and the contract note below are corrected. |
| B2 | Mirror panel, live | The 16:9 frame is `flex: 1 1 auto` with `max-inline-size: 100%` and no block bound; with a content-sized panel it takes the full width (688 → 387 px tall, body 408) and the shape clips the bottom of the picture. Only the *off* state was visible in the app run (no camera); the `Live` story shows it. | Panel 190–360 | The frame gets an explicit height, `--mirror-frame: 236px` (284 − the panel's 8 px padding − head 28 − gap 12); `aspect-ratio` transfers it to the width (420 px), centred. |

### Should

| # | Surface | Finding | Spec | Decision |
| --- | --- | --- | --- | --- |
| S1 | `SegmentedControl` | Segments are `flex: 1 1 0`, so Chromium sizes the track to the *sum* of the labels and then shares it equally — the widest label is always cut: "Short b…" / "Long b…" (Pomodoro), "Reser…" / "Comfor…" (Settings › Layout), in stories and in the app. | Segmented control height 28, padding 0 12; labels never truncate at their natural width | Track becomes `inline-grid` with `grid-auto-columns: 1fr`, which sizes every column to the widest label; segments keep `min-inline-size: 0` so a constrained parent still ellipsises. |
| S2 | Settings › Layout | "Compact 26 px, Default 32 px, Comfortable 38 px." ellipsises beside its control in the 640 column (269 of 285 px), worse after S1. | Copy: say it once | Body becomes "26, 32 or 38 px tall." in all five catalogs. |
| S3 | Translation panel | Source and output boxes are `flex: 1 1 0` in a content-sized panel: the output collapses to 16 px until text arrives and the panel resizes as the answer streams. | Panel height follows content; a panel does not jump while it works | Both boxes get a fixed `--translation-box` height (five lines, 96 px) so the panel is 190 px at rest and stays put while streaming. |
| S4 | Code hosting panel | `.code-hosting-queue__list` scrolls (`overflow-y: auto`) but has no bound; with twelve pull requests the body is 689 px and the shape clips it (`LongContent` story). | Panel ≤ 360; lists scroll inside `max-block-size` like every other module | `max-block-size: var(--code-hosting-list-max)` (212 px, what 284 leaves after the head and the filter row). |
| S5 | Health panel | The four flow cards sit in two columns of the right grid column (`minmax(220px, 1.3fr)`); at the minimum panel width the text column is 26 px wide and every name and length ellipsises ("Mo…", "3 m…"). Fine at 1000 px. | Text does not truncate at the minimum size | `.health-cards` becomes `repeat(auto-fit, minmax(var(--health-card-min), 1fr))` — one column at 720, two from ~ 860. |
| S6 | System monitor panel | Tile values ellipsise at the minimum width ("700.0 …", "of 1,000.0…", "↓ 300 kB/s ↑ 12 kB/s" needs 125 px, has 70). Fine at 1000 px. | Same | `.sysmon-grid` becomes `repeat(auto-fit, minmax(var(--sysmon-tile-min), 1fr))` — two columns at 720, three from ~ 870; the file's height budget still holds (three rows 186 px). |
| S7 | `styles.css` | `-webkit-font-smoothing: antialiased` on `body`. | "not applied" ([05 › Typography](../05-design-system.md#typography)) | Removed. |
| S8 | Health panel | `font-size: 10px` (ring label) and `11px` (streak) literals. | Type scale tokens only | `--text-caption2` / `--text-caption`. |
| S9 | Health panel, onboarding, `Marquee` | Static `will-change: transform` (`health.css`, `onboarding.css` ×2, `marquee.css`). | Motion adds `will-change` during animation only ([06 › Performance](../06-motion-spec.md#performance-rules)) | Removed; Motion promotes the layers it animates. |
| S10 | Health panel | The breathing dial animates with `{ duration, ease: 'easeInOut' }` written in the module. | Module code never writes durations or easings; presets come from `@muna/ui/motion` | A `paced(ms)` helper in `@muna/ui/motion` (linear-to-eased timed tween for content-driven cycles) replaces the literal. |
| S11 | Shelf panel | Selection scrim `rgb(0 0 0 / 0.6)`. | `--scrim` | Token. |
| S12 | Copy | "Open Settings" (health, mirror, translation) vs "Open settings" (nine others); "in settings" (weather ×3) and "reopen settings" vs "in Settings" (twenty others). | Sentence case; the window is called Settings in prose, the button says "Open settings" ([m1-shell](../build-plan/m1-shell.md), [ai-coding.md](../modules/ai-coding.md)) | English unified to "Open settings" and "in Settings"; the four translations already follow their glossary word. |

### Nit

| # | Surface | Finding | Decision |
| --- | --- | --- | --- |
| N1 | Mirror video | `background: #000`. | `var(--notch-black)`. |
| N2 | `MonthGrid`, calendar settings | `border-radius: 8px` and `999px` literals. | `--radius-control`, `--radius-thumb`. |
| N3 | `BatteryGlyph` | Bolt stroke `rgb(0 0 0 / .65)`. | Accepted: the bolt is cut out of the fill and has no token equivalent; documented in the file. |
| N4 | `StripView` | App icon `border-radius: 6px`. | Accepted: 05 gives "AppIcon rounded 6 at 20 px" and there is no 6 px token. |
| N5 | Calendar, screen time, onboarding, waveform | 1.5–4 px radii on bars and dots. | Accepted: sub-token detail radii. |
| N6 | Weather panel | Sky gradients in literal colours. | Accepted: illustration colours, not UI tokens ([weather.md](../modules/weather.md)). |
| N7 | Media | Album-art bleed and strip halo are `box-shadow`s outside the three shadow tokens. | Accepted and now written into 05 › Elevation: they are content colour (the palette), not elevation, and are the only allowed exception. |
| N8 | `Text` | `text-transform: uppercase` on the 10 px ring label. | Accepted: the one sanctioned all-caps label. |
| N9 | Calendar agenda | "Monday, September 28" ellipsises (145 of 167 px) when the feed notice chip shares the row. | Accepted for now; the chip is rare and the date reads. |
| N10 | AI coding, translation, support | Developer-facing terms (JSON, hooks, bearer token, loopback, API key, endpoint). | Accepted: the audience of those three modules. |

## Observed on spec

Strip forms (idle, now playing with waveform, volume HUD, charging, agent waiting, timer),
surface states and radii, panel chrome (44 px header, rail, chips), module bar (640 × 40, 12
below the panel, pager dots), media (art glide, transport row, times), calendar (month grid
and agenda), pomodoro (ring, segmented presets after S1), day progress, screen time (donut,
ranking), weather (sky card, hourly and daily rows), notifications (groups, actions, scroller
at 248 px), tasks, notes and editor, shelf, bluetooth, AI coding, support and What's new,
command palette, drop row and snap zones, every settings pane, the welcome tour; motion
presets are imported from `@muna/ui/motion` everywhere except S10; no exclamation marks in
1580 strings; two font weights; hairline and surface tokens throughout.

## Found while fixing

Bounding the panels above made the content-height `PanelFrame` show the same class of defect
in five more modules: their scrolling lists had `flex: 0 1 auto; min-block-size: 0` and no
bound, which was enough under a fixed-height frame and is nothing under a content-sized one.
The surface then clipped the overflow, and axe sampled the hidden rows against the story
background (`color-contrast` on the notes and AI coding *Long content* stories). Giving the
dashboard its rows then showed what its narrow cards do at the minimum width. All fixed in
the same PR.

| # | Surface | Finding | Decision |
| --- | --- | --- | --- |
| F1 | AI coding panel, long content | The sessions list grows with its rows (body 577 px at eight sessions); the surface clips everything past 284. In the running app the panel measured 300. | The list scrolls inside `--ai-coding-scroll: 240px` under the counts line. |
| F2 | Notes panel and editor | The rows grow with the notes (body 681 px at fourteen; 285 at the default five); the editor's `TextArea` collapses to one line (36 px) and the preview has no bound. | Rows and preview scroll inside `--notes-scroll: 219px`; the text area is 219 px tall. |
| F3 | Shelf panel | The grid's `--shelf-grid-max` was 220 but the status line is 28 tall (its buttons), not the 20 the budget assumed; body 292. In the app 279 with fewer rows. | `--shelf-grid-max: 212px`; the file's budget comment corrected. |
| F4 | Support panel | Six 44 px rows plus the version line make 289; the changelog view 331; with the outcome line the running app measured 365 — over the maximum, so the shell clamped it and the surface clipped the last row and the outcome line. | List and changelog scroll inside `--support-scroll: 220px` (five rows), leaving room for the head or version line and the outcome line. |
| F5 | Weather panel at 720 | The six chips wrap to two rows at the minimum width (they fit in one from about 760), so the body is 294; fine in the app at 1000 (266). | A container query under 760 px tightens the chip rows and the strip cells: 282. |
| F6 | Dashboard widgets at 720 | Once the grid had rows, the narrow cards (142 px of body at the minimum width) ellipsised the system gauges (*Memory*, *15.9 GB*), the pomodoro status (*Running*), a task's due beside its title and the day widget's *Starts at 9:00 AM*. Fine from about 860 px. | The card body is a size container; under 180 px the system gauges stack ring over text, the pomodoro row closes its gaps, a task keeps its title (the due goes to screen readers and the red moves to the title), the day rows wrap whole. |

The "Observed on spec" list above stands for every surface except the height of these five
at 720 px and the narrow dashboard cards, which the earlier frame could not show.

## Contract clarified

A panel's height **follows its content** between 190 and 360 px; the shell measures the
panel and animates to it. A module that wants a fixed layout declares its own heights (rows,
frames, list bounds) and never relies on the body being 284 px — `flex: 1 1 0`,
`block-size: 100%` and `min-block-size: 0` alone resolve to nothing there. Recorded in
[05 › Spacing & sizing](../05-design-system.md#spacing--sizing) (the *Panel body* row);
`dashboard.md`, `mirror.md`, `translation.md`, `system-monitor.md`, `health.md`, `notes.md`,
`ai-coding.md`, `code-hosting.md`, `shelf.md`, `support.md` and `weather.md` record each
module's budget. The health breathing circle's content-paced tween became `paced()` in
`@muna/ui/motion`, recorded in [06 › Timings](../06-motion-spec.md#timings-non-spring).
