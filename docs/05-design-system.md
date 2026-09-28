# 05 · Design system

Muna should look like it was shipped by the platform vendor, not by a web app. The design
system encodes that: **one material (black glass), one type scale, one motion vocabulary, one
set of tokens** — used identically in the notch, the settings window, Storybook and the site.

Sources: the UI anatomy measured from the reference screenshots
([`reference/ui-observations.md`](reference/ui-observations.md)), Apple's Human Interface
Guidelines (Live Activities, typography, materials), and Windows conventions where the two
conflict (Settings window follows Windows theme; the notch never does).

Implementation: `packages/ui/src/tokens/tokens.css` (CSS custom properties, exported as
`@muna/ui/tokens.css`) → Tailwind v4 `@theme` (`theme.css`) → primitives in
`packages/ui/src/primitives`. **No hard-coded colours, radii, sizes or durations in module
code.**

## Principles

1. **Deference.** The notch is furniture. It is black, silent and small until asked; it never
   glows, pulses or advertises. Content is the only colour.
2. **Physicality.** One continuous object morphs between states; nothing fades in from
   nowhere. Corners are continuous (squircle), edges are hairlines, depth comes from
   translucency and light, not from drop shadows on every card.
3. **Legibility first.** White text on black at three fixed opacities; sizes from one scale;
   tabular numerals for anything that counts.
4. **Windows-aware.** Segoe UI Variable is honoured in the Settings window; the notch bundles
   Inter so the silhouette and metrics are identical on Win10 and Win11. Hit targets respect
   touch and 200 % scaling.
5. **Restraint in colour.** Accents are semantic (media = cyan, focus/pomodoro = warm orange,
   health = green/blue/purple rings, danger = red). Never more than one accent per surface,
   except rings and charts.

## Tokens

### Colour

Notch surfaces are dark regardless of OS theme. The Settings window gets both themes.

| Token | Value (dark) | Use |
| ------- | -------------- | ----- |
| `--notch-black` | `#000000` | Collapsed strip fill (matches a hardware notch) |
| `--panel-top` | `#0C0C0E` | Panel gradient start |
| `--panel-bottom` | `#050506` | Panel gradient end |
| `--surface-1` | `rgb(255 255 255 / 0.04)` | Cards, list rows (resting) |
| `--surface-2` | `rgb(255 255 255 / 0.07)` | Hovered rows, chips, module bar |
| `--surface-3` | `rgb(255 255 255 / 0.11)` | Pressed, active segment, selected |
| `--surface-4` | `rgb(255 255 255 / 0.16)` | Slider fill (resting), thumb |
| `--hairline` | `rgb(255 255 255 / 0.10)` | 1 px borders, dividers |
| `--hairline-strong` | `rgb(255 255 255 / 0.18)` | Focused input border |
| `--text-1` | `rgb(255 255 255 / 1)` | Primary |
| `--text-2` | `rgb(255 255 255 / 0.60)` | Secondary |
| `--text-3` | `rgb(255 255 255 / 0.40)` | Disabled glyphs and labels, decorative marks — never text a user must read (3.7:1) |
| `--accent-blue` | `#0A84FF` | Links, selection, focus ring |
| `--accent-cyan` | `#64D2FF` | Media, waveform |
| `--accent-green` | `#30D158` | Success, connected, health move |
| `--accent-orange` | `#FF9F0A` | Pomodoro, warnings, charging |
| `--accent-red` | `#FF453A` | Destructive, errors, recording |
| `--accent-purple` | `#BF5AF2` | Health stand, AI coding |
| `--accent-yellow` | `#FFD60A` | Weather sun, stars |
| `--accent-pink` | `#FF375F` | Health heart |
| `--accent` | user-selectable, default `--accent-blue` | Active module indicator, toggles |
| `--on-accent` | `#000000` | Label and glyph on an accent fill (primary button, toggle knob on); white on `#0A84FF` is 3.96:1, black is 5.8:1 |
| `--scrim` | `rgb(0 0 0 / 0.55)` | Behind modal-like drawers inside the panel |

Media surfaces may tint `--surface-*` with the album palette through `--media-tint`
(`color-mix(in oklab, var(--surface-2), var(--media-tint) 22%)`); the tint never exceeds 30 %
and never touches text.

Light-theme Settings window: neutrals invert (`--bg #F5F5F7`, `--surface-1 rgb(0 0 0 / .04)`,
`--text-1 #1D1D1F`, `--text-2 rgb(0 0 0 / .6)`, `--hairline rgb(0 0 0 / .1)`); accents use the
light-appearance variants (`#007AFF`, `#34C759`, `#FF9500`, `#FF3B30`, `#AF52DE`, `#32ADE6`).

Contrast: `--text-2` on `--panel-bottom` is 7.33:1 and passes AA for body text; `--text-3` is
3.71:1 and does not. A 12 px minimum does not exempt text from the 4.5:1 requirement; see
the known gap under [Accessibility](#accessibility). Under `prefers-contrast: more` (Windows "Contrast
themes" / high-contrast) the tokens shift: `--hairline` → 0.24, `--text-2` → 0.72, `--text-3` →
0.56, and the strip gains a 1 px `--hairline` outline so the black shape stays visible on dark
wallpapers.

### Materials

| Material | Recipe |
| ---------- | -------- |
| **Strip** | `background: var(--notch-black)`; no border; bottom corners only |
| **Panel** | `background: linear-gradient(180deg, var(--panel-top), var(--panel-bottom))`; `box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06)` (top catch-light); 1 px `--hairline` border except the top edge; outer shadow is the layered `--shadow-panel` (below), painted by us (Tauri `shadow:false`) inside a 20 px transparent window margin |
| **Island** (floating shape) | Panel material plus all four corners; 1 px hairline all round |
| **Module bar** | `--surface-2` painted over `--notch-black` (the pill floats on a transparent window, so the black base is part of the material), radius 20, hairline; no wider than the panel bound or the viewport |
| **Card** | `--surface-1`, radius 12, no border; hover → `--surface-2` |
| **Popover** (device picker, menus) | `#141416` at 96 %, radius 14, hairline, `--shadow-popover` |
| **Scrim** | `--scrim`, no blur |

Shadows (only three exist):

| Token | Value |
| ------- | ------- |
| `--shadow-panel` | `0 1px 2px rgb(0 0 0 / .35), 0 6px 16px rgb(0 0 0 / .35), 0 20px 40px rgb(0 0 0 / .30)` — three layers read as one soft contact shadow plus ambient depth |
| `--shadow-popover` | `0 1px 2px rgb(0 0 0 / .35), 0 12px 32px rgb(0 0 0 / .50)` |
| `--shadow-drag` | `0 8px 24px rgb(0 0 0 / .45)` (drag previews only) |

Cards, chips and rows have no shadow. Because the notch window is transparent, the window
rect includes a **20 px shadow padding** on every side so `--shadow-panel` (and spring
overshoot) is never clipped by the window edge.

No `backdrop-filter` on the notch (it cannot blur other apps under a transparent window;
see [ADR-0001](adr/0001-tech-stack.md)). Inside the panel, `backdrop-filter: blur(20px)` is
allowed only on popovers over panel content (small area).

### Shape

Continuous ("squircle") corners everywhere the silhouette is visible, and **concentric
corners** everywhere one rounded shape sits inside another: `inner radius = outer radius −
margin`, clamped to a minimum of 8. This is why the tokens below are not arbitrary — panel 28
with 16 px padding gives cards 12; a 12 px card with 12 px padding gives controls the 8 px
floor.

| Token | px | Where |
| ------- | ---- | ------- |
| `--radius-strip` | 14 | Strip bottom corners (Notch shape); the top edge is flush with the screen and flares outward (below) |
| `--radius-panel` | 28 | Expanded panel bottom corners |
| `--radius-island` | 32 | Island shape, all corners, **constant** in every state — 32 clamps to a full capsule on the 36 px collapsed pill and reads as a 32 px corner when expanded, so the radius never animates |
| `--radius-bar` | 20 | Module bar pill (active pill inside it: 16) |
| `--radius-card` | 12 | Cards, widgets, list groups (= panel 28 − padding 16) |
| `--radius-tile` | 12 | Drop-action tiles (same maths inside the wide strip) |
| `--radius-popover` | 14 | Popovers, menus (menu items inside: 10) |
| `--radius-control` | 8 | Chips, segmented controls, inputs, buttons inside cards |
| `--radius-thumb` | 999 | Circles: icon buttons, avatars, rings |

Apple reference (HIG Live Activities): the Dynamic Island uses a 44 pt radius on a 250 × 36.67
compact / 408 × 84–160 expanded island; Muna's 32 px on a 36 px pill is the same
"fully-rounded when compact, visibly rounded when expanded" idea at Windows UI scale.

**Notch flare.** A real MacBook notch does not have square top corners: the top edge curves
*outward* into the bezel. Notch shape is therefore drawn as a single SVG `<path>` with four
radii (top-outer fillets 6 px collapsed → 19 px expanded; bottom corners 14 → 28 — the
proportions boring.notch uses), animated via `motion.path` on the same spring as the size.
Island shape uses plain `border-radius`.

Implementation of continuous corners: feature-detect
`CSS.supports("corner-shape", "squircle")` (Chromium 139+ behind a flag at research time; the
Evergreen WebView2 will pick it up) and use `corner-shape: squircle` with `border-radius`;
otherwise generate a Figma-style smoothed path (`corner-smoothing: 0.6`) with the
figma-squircle algorithm in `packages/ui/src/shape/squircle.ts` and apply it as
`clip-path: path()`. **Never regenerate the squircle path per animation frame** — morphs run
with plain `border-radius` and the smoothed mask is swapped in at rest (see
[motion spec](06-motion-spec.md#strip--panel-expand)). The notch outer silhouette must use
the same function in the Rust-side hit-test rects — export the path points from the same TS
module via specta.

**As built (M0-E4, `packages/ui/src/shape`, `NotchSurface`).**

- The flared silhouette is `notchPath()` in `shape/notch-path.ts`: six **circular arcs**
  (`A` commands), not squircles. A fillet of 6/19 px has no room for a smoothing curve and must
  be exactly tangent to the screen edge and to the side wall; squircle smoothing (0.6) applies
  to islands and to nested rectangles (cards, tiles, controls). The path's bounding box is
  `body width + 2 × top radius` — the flares are part of the surface's box, so a 200 px strip
  occupies 212 px collapsed and a 420 px panel 458 px expanded. `notchOutline()` samples the
  same path clockwise for the Rust hit-test.
- At rest the notch is a `clip-path: path()` mask; the island uses `corner-shape: squircle`
  when the engine has it and the figma-squircle `clip-path` otherwise. While the parent morphs
  the size (`morphing` prop) both masks are dropped and the shape runs on `border-radius`; the
  flare path is cheap enough to animate per frame in M1-E1 (the squircle is not).
- A CSS border cannot follow a `clip-path`, so on a clipped surface the hairline is an SVG
  stroke drawn along the identical path: 2 px wide, half of it clipped away by the mask, which
  leaves exactly 1 px inside the shape. The strip's outline is drawn only in increased contrast.
- `--shadow-panel` is painted by a sibling node inset by the flare width, so the shadow hugs
  the black body and never the bezel fillets.

### Spacing & sizing

4 px grid. `--space-1 … --space-8` = 4, 8, 12, 16, 20, 24, 32, 40.

| Element | Size |
| --------- | ------ |
| Strip | height 32 (user 28–36), width 200 default (presets 180/200/240/280; reference apps 185–200), two 20 px slots inset 10 px from each edge |
| Island (collapsed) | 120 × 36 pill, 6–8 px top offset; hover reveal 160 × 40; expanded ≤ 380 × 340 |
| Peek | 6 px tall, same width |
| Wide strip | up to 420 wide during wide form |
| Panel | width `min(1000, monitor − 80)` (Rust supplies the bound; the UI also caps to its own window width, so a narrow work area or 200 % zoom gets a panel that fits rather than one clipped at 720); height by content, min 190, max 360, body scrolls beyond that |
| Panel padding | 16 all round (keeps card corners concentric); header ≥ 44 tall (grows when a long title wraps) |
| Module bar | 640 × 40, 12 px gap below panel; icons 20, gap 8, active pill 32 × 32 |
| Icon button | 28 circle, icon 16; large 36 circle, icon 20 |
| Chip | height 24, padding 0 10, icon 12, text 12/600 |
| List row | height 44; leading icon 20; trailing value `--text-2` |
| Card | padding 12; header 13/600; body 12 |
| Progress track | height 4, radius 2; thumb 12 on hover |
| Slider (HUD) | track 96 × 6, radius 3 |
| Ring | stroke 8 (S: 6), gap between rings 4 |
| Toggle | 36 × 20, knob 16 |
| Segmented control | height 28, segment padding 0 12 |
| Drop tile | 112 × 88, icon 24, label 12 |
| Tooltip | height 24, padding 0 8, `#000 / .9`, radius 8, 11/500 |
| Min hit area | 28 × 28 visual; 36 × 36 effective via padding; 44 on touch |
| Window rect | maximum expanded bounds + 20 px shadow padding per side + ~8 % overshoot headroom |

### Typography

Font stack: `"Inter Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`.
SF Pro is **not** an option (Apple's licence limits it to Apple platforms); Inter is the
closest open alternative and is bundled (`font-display: block`, subset Latin + Latin-ext +
Cyrillic; other scripts fall to Segoe/Noto). Geist (also OFL) is the sanctioned alternative if
the team prefers its tighter rhythm — swap the bundle, not the tokens. Features:
`font-feature-settings: "cv11", "ss01", "calt"` (single-storey *a*, open digits — the two
Inter options that read most like SF); `font-variant-numeric: tabular-nums` on any number that
changes (timers, percentages, counters). `-webkit-font-smoothing: antialiased` is *not*
applied (Windows ClearType). When Inter fails to load, Segoe UI Variable's optical sizes
(Small/Text/Display) are chosen by the browser automatically; metrics are close enough that
layouts hold.

| Token | Size / line | Weight | Tracking | Use |
| ------- | ------------- | -------- | ---------- | ----- |
| `--text-caption2` | 10 / 12 | 500 | +0.01em | Ring labels, tiny units |
| `--text-caption` | 11 / 13 | 500 | 0 | Timestamps, chip meta |
| `--text-footnote` | 12 / 16 | 400 / 600 | 0 | Card body, list secondary |
| `--text-body` | 13 / 18 | 400 / 600 | 0 | Default UI text, list primary, settings |
| `--text-callout` | 15 / 20 | 600 | −0.005em | Panel titles, card values |
| `--text-title3` | 17 / 22 | 600 | −0.01em | Module headers, big values |
| `--text-title2` | 22 / 28 | 600 | −0.015em | Dashboard totals |
| `--text-title1` | 28 / 34 | 600 | −0.02em | Clock in expanded panel |
| `--text-display` | 34 / 40 | 700 | −0.02em | HUD percentage, Pomodoro countdown |

Rules: max two weights per surface; **prefer 600 over 700** (Inter Bold looks heavy at UI
sizes; 700 is reserved for `--text-display`); secondary text is `--text-2`, never a smaller
size at full white; truncate with ellipsis at one line for names in lists and two lines for
bodies (`text-wrap: pretty`, `-webkit-line-clamp: 2`) — but a truncated value must stay
reachable somewhere (tooltip, detail view), and the panel title and subtitle wrap instead of
truncating because nothing else shows them in full; sentence case everywhere; no all-caps
labels except 10 px ring labels (`letter-spacing: .06em`).

### Iconography

[Lucide](https://lucide.dev) (ISC licence) at 16/20/24 with `stroke-width` 1.75 (16 px) and
1.5 (20/24 px) to match text weight; filled variants only for states (play/pause, heart,
star). App/brand glyphs (Spotify, GitHub, Teams) come from Simple Icons as monochrome. No SF
Symbols, no Fluent emoji, no Apple/MacNotch marks. Muna's own mark: a black rounded strip with
a single cyan dot — `packages/ui/assets/mark.svg`.

### Elevation & focus

- Only the three shadow tokens above exist (`--shadow-panel`, `--shadow-popover`,
  `--shadow-drag`). Cards have none.
- Focus ring: `outline: 2px solid var(--accent); outline-offset: 2px; border-radius: inherit`,
  shown for keyboard focus (`:focus-visible`) only.
- Pressed state: scale 0.96 + `--surface-3` (see motion spec); hover: tint only, no lift.

## Components

Primitives (`packages/ui`): `NotchSurface`, `Hairline`, `Text`, `IconButton`, `Button`
(primary = accent fill on black, secondary = `--surface-2`, destructive = red text), `Chip`,
`Card`, `ListRow`, `SegmentedControl`, `OptionTiles` (radio tiles with an illustration slot,
for choices worth a picture), `Toggle`, `Slider`, `SearchField`, `ProgressTrack`, `Ring`,
`Skeleton`, `EmptyState` (icon 24 `--text-3`, one sentence, one action), `ErrorState`,
`PanelChrome` (header, rail, body, footer slots), `ModuleBar` (the pill row), `Tooltip`,
`Popover`, `Menu`, `Kbd`, `Avatar`, `AppIcon` (rounded 6 at 20 px), `Marquee`.

Shell (`apps/desktop/src/shell`): `Strip` (slots, wide form), `Peek`, `Hud`, `Notice`,
`Panel` (binds `PanelChrome` to the notch state machine, the pin and the active module),
the module bar binding (order, active module, `Ctrl+Tab`), `DropTiles`, `SnapZones`.
The chrome and pill primitives live in `@muna/ui` so Storybook can exercise every state; the
shell only wires them to state and i18n.

Every component has Storybook stories for Default / Hover / Pressed / Focus / Disabled /
LongContent / RTL / ReducedMotion, and a Vitest render test.

State recipes shared by the M0-E4 primitives (`IconButton`, `Chip`, `ProgressTrack`, `Ring`,
`Text`, `Hairline`, `NotchSurface`):

| State | Recipe |
| ------- | -------- |
| Icon button rest | transparent, glyph `--text-2` (the glyph brightens rather than the button lifting) |
| Icon button hover | `--surface-2`, glyph `--text-1` |
| Icon button pressed / active | `--surface-3`, glyph `--text-1`; pressed adds `scale(0.96)` |
| Disabled | glyph or label `--text-3`, no background |
| Chip selected | `--surface-3`; the 12 px icon goes `--text-2` → `--text-1` |
| Progress fill | the tint (`--muna-tint`, one of the accent tokens) on a `--surface-4` track |
| Ring track | the tint at 20 % (`color-mix(in oklab, tint 20%, transparent)`) so an empty ring still reads in its colour |
| Ring value | the tint, round caps, starting at 12 o'clock |

Pure-CSS state changes (hover tint, press scale, chip select) transition with the `press` /
`toggle` / `reveal` presets rendered as CSS `linear()` easings — see
[motion spec → presets in CSS](06-motion-spec.md#presets-in-css).

## Per-surface notes

- **Strip**: content is centred in the two slots; the centre 60 % stays empty black (the
  "camera"). Text in the wide form is `--text-footnote` 600, white, one line, marquee only if
  overflowing after 1.5 s hover.
- **HUD**: glyph 16 leading, 96 × 6 track, value optional as `--text-caption` tabular.
- **Panel header**: title `--text-callout` left, wrapping when long; chips beside it while
  there is room, otherwise chips and rail wrap to a second row; right rail of 28 px icon
  buttons with 8 px gap (their 36 px hit areas stay disjoint);
  ⤡ collapse is always the right-most.
- **Dashboard widgets**: S 1×1 (156 × 120), M 2×1, L 2×2 on a 12 px gap grid; header row
  12/600 `--text-2` + icon 14; values `--text-title3`.
- **Settings**: Windows-native window; sidebar 220 wide with 32 px rows and 16 px icons;
  content max-width 640; section header 13/600 `--text-2`; rows 44 with trailing controls.
- **Onboarding**: 560 × 420 centred cards, illustrations use the same tokens.

## Accessibility

Contrast ≥ 4.5:1 for text, 3:1 for icons/controls; names on every icon button; focus order
follows layout; Esc always collapses/closes; `prefers-contrast: more` **or** the app's
`[data-contrast=more]` applies the values in the Colour section (`--hairline` 0.24, `--text-2`
0.72, `--text-3` 0.56, strip outline) and removes media tints; reduced motion per the
[motion spec](06-motion-spec.md); no information conveyed by colour alone (rings carry labels;
status has icon + text).

Resolved (M1 follow-up, 2026-09-28): `--text-3` (white at 40 %) is **3.7:1** on
`--panel-bottom` and no single alpha passes 4.5:1 on every surface and appearance — 46 %
fails on `--surface-3`/`--surface-4` and on the light Settings base
([colour matrix](reference/glass-ui-research.md#deeper-compositing-measurements)). The
token therefore keeps its value and loses its text role: `Text tone="tertiary"` and search
placeholders render `--text-2` (7.3:1), and `--text-3` is reserved for disabled glyphs and
decorative marks. The Storybook "Tones" story no longer disables axe's `color-contrast`
rule; `storybook:ci` runs it unrestricted on every story.

Screen readers: the collapsed strip and live activities are one `role="status"` region with
`aria-live="polite"` so a track change or "AirPods connected" is announced without stealing
focus; HUD value changes are announced at most once per second (`aria-atomic`, throttled);
the expanded panel is `role="dialog" aria-modal="false"` labelled by the module title; the
module bar is `role="tablist"`. Nothing inside the notch ever traps focus.

## Writing

Sentence case; no exclamation marks; verbs on buttons ("Connect", "Snooze 10 min"); empty
states name the next action; errors state what happened and what to do; units with a thin
space ("64 %", "2 h 15 min"); times in the user's Windows locale via `Intl`.

## Don'ts

Gradient text · glows/neon borders · glassmorphism blur on the strip · drop shadows on cards ·
emoji in UI · linear/ease-in-out easings on shape changes · mixed icon sets · uppercase labels ·
tinted text on media surfaces · anything that animates while the notch is collapsed and idle ·
non-concentric nested corners · squircle paths regenerated per frame.

## References

- Apple Human Interface Guidelines — Live Activities (Dynamic Island sizes and 44 pt radius):
  <https://developer.apple.com/design/human-interface-guidelines/live-activities>
- Apple Human Interface Guidelines — Typography, Color, Materials:
  <https://developer.apple.com/design/human-interface-guidelines>
- Figma — "Desperately seeking squircles" (corner smoothing model):
  <https://www.figma.com/blog/desperately-seeking-squircles/>
- figma-squircle (`clip-path` fallback algorithm): <https://github.com/phamfoo/figma-squircle>
- CSS `corner-shape` (CSS Borders Level 4): <https://drafts.csswg.org/css-borders-4/#corner-shaping>
- Inter (features `cv11`, `ss01`): <https://rsms.me/inter/> · Geist: <https://vercel.com/font>
- Lucide icons: <https://lucide.dev> · Simple Icons: <https://simpleicons.org>
- Reference notch/island implementations studied for proportions:
  [boring.notch](https://github.com/TheBoredTeam/boring.notch) (notch path radii),
  [DynamicNotchKit](https://github.com/MrKai77/DynamicNotchKit),
  [PILLAR](https://github.com/warpirate/pillar-dynamic-island-for-windows) and
  [Dynamic-Island-for-Windows](https://github.com/devcode90/Dynamic-Island-for-Windows)
  (Windows pill sizes), [spectrum-ui](https://github.com/arihantcodes/spectrum-ui) (React
  Dynamic Island component).
