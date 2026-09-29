# Glass UI research and implementation skill

**Status:** Baseline findings implemented and re-measured; native performance checks open.
**Date:** 2026-09-28.
**Baseline:** `9fe73bdc30be9ace0c5b43f7e59339f1b47a4f1f`.

**Research extension:** fonts, color systems, frontend libraries, assets, UX, and motion
were investigated further on the same date. The comparison below is a suitability assessment,
not a benchmark of uninstalled libraries or a claim of user-tested visual superiority.

## Navigation

- [Research and material constraints](#research-and-implications)
- [Visual direction and toolkit](#visual-direction-and-toolkit)
- [Typography research](#typography-research)
- [Color-system research](#color-system-research)
- [Frontend framework and component comparison](#frontend-framework-and-component-comparison)
- [Icons and assets](#icons-and-assets)
- [Experience design](#experience-design)
- [Animation and motion research](#animation-and-motion-research)
- [Prototype and selection protocol](#prototype-and-selection-protocol)
- [Local reference repository adoption](#local-reference-repository-adoption)
- [Ranked baseline findings](#ranked-findings)
- [Reusable implementation skill](#final-implementation-skill)
- [Verification and test results](#verification-and-test-results)
- [Implementation results](#implementation-results)

## Recommendation

Make Muna feel like **one quiet, responsive object**, not a collection of translucent cards.
Keep the black strip, opaque near-black panel, continuous corners, restrained catch-light,
and existing physics springs. Fix contrast, adaptable geometry, and oversized content blur
before introducing another visual effect.

The highest-value glass improvement is a dependable dark foundation under the floating
module bar. It currently paints translucent white without its documented black base, so
white glyphs disappear against a white background. More blur would not solve that.

This is a research report and reusable implementation skill, **not an implemented redesign
or an installed agent skill**. UI source, tokens, presets, and check configurations were not
changed. The contradictory contrast prose in the design-system document was corrected.

## Scope and coverage

Reviewed the core strip-to-panel flow: shell geometry and choreography, shared
`NotchSurface`, `PanelChrome`, `ModuleBar`, text tokens, empty/error states, and loading
motion. Browser evidence uses existing Storybook fixtures, not a running native Tauri app.
Settings, individual feature modules, native hit-testing, and OS backdrop implementation
are outside the audit boundary.

Stack: React 19, strict TypeScript, Tailwind v4, CSS custom properties, React Aria,
Motion, Tauri v2, Rust, and WebView2. Keep this stack.

Convention sources inspected: `.github/copilot-instructions.md`, `docs/README.md`,
[design system](../05-design-system.md), [motion spec](../06-motion-spec.md),
[testing strategy](../09-testing-qa.md), [ADR-0001](../adr/0001-tech-stack.md), and
[reference observations](ui-observations.md).

All six domain skills were loaded and applied in the order below for the initial baseline.
The later local-repository comparison used two read-only research agents for independent
references, with the Muna mapping and boring.notch inspection performed in this session.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | React Aria icon controls, keyboard module switching, focus outline, hit areas, reduced motion, error alert | 1 owning finding; native focus and Narrator not verified |
| Layout | Panel and module-bar source; 1000 px and 320 px browser viewports; RTL fixture | 2 findings; native DPI and actual 200% browser zoom not verified |
| Writing | Shell English strings, empty-state wiring, rendered recovery message | 1 finding |
| Typography | Text primitive, token scale, rendered long title/subtitle | 1 finding |
| Colors | Token compositing, unrestricted axe run, white-background module-bar experiment | 2 findings; full Settings light theme not reviewed |
| UI polish | Surface screenshots, morph end states, content recipes, reduced-motion styles | 1 finding; frame pacing and 10%-speed replay not verified |

States covered: resting strip/panel, long content, empty, error, loading, keyboard focus,
hover with reduced motion, module overflow, and RTL. No blanket accessibility or visual
approval is implied by passing automated checks.

## Research and implications

Primary sources were read on 2026-09-28. The recommendations below are paraphrases,
not copies of platform assets or claims that their native effects are available in CSS.

| Source | Verified guidance | Decision for Muna |
| --- | --- | --- |
| [Apple: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) | Reserve glass for the navigation/control layer; avoid glass on glass; preserve concentricity; adapt for contrast, reduced transparency, and reduced motion | Use one material plane with quiet content fills. Borrow hierarchy and continuity, not continuous lensing, glow, or sensor-driven effects |
| [Microsoft: Acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic) | Background acrylic suits transient surfaces; stacked acrylic adds noise; rendering costs GPU/power; solid fallbacks apply for accessibility, battery, hardware, and inactive windows | Native acrylic is an optional platform experiment, not the default notch material |
| [Microsoft: Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica) | Mica is opaque, wallpaper-derived, and designed for long-lived windows; it is not a live blur of apps underneath | Consider only for a future Settings-window experiment, not as the solution to transparent notch glass |
| [Motion: Layout animations](https://motion.dev/docs/react-layout-animations) | Layout animation uses transforms; shared identities connect elements between states | Retain Muna's documented real-size shell exception instead of blindly adding `layout` to the entire panel |
| [Motion: Accessibility](https://motion.dev/docs/react-accessibility) | `MotionConfig` and reduced-motion hooks support replacing spatial animation with opacity and disabling autoplay/parallax | Keep `MunaMotionProvider`; explicitly remove blur, rise, and scale in reduced variants |
| [W3C: Contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Normal text needs 4.5:1; compare without rounding the threshold; foreground/background styles matter | Measure composited alpha colors; small text does not become exempt at 12 px |

The Apple HIG materials page returned only its title through the fetch tool; the readable
WWDC transcript above is the evidence used for Apple's recommendations.

### Glass is not one implementation

| Approach | What it actually does | Recommendation |
| --- | --- | --- |
| Current black glass | Opaque gradient, hairline, catch-light, and one exterior shadow | Default: predictable contrast and no desktop capture |
| In-app CSS backdrop blur | Blurs content behind an element inside the web rendering surface | Small popovers only, as already allowed by the design system |
| Native desktop backdrop | Uses OS composition to include wallpaper or other windows | Separate, opt-in Rust/platform spike with documented fallback |
| Refraction simulation | Adds lensing, displacement, or animated highlight effects | Do not add to the always-on utility; costs and distraction are unproven |

As ADR-0001 records, `backdrop-filter` in a transparent WebView2 window cannot blur other
applications behind it. A browser demo over an image cannot prove native desktop glass.
Do not introduce screenshot capture loops, a shader dependency, or undocumented Windows
APIs to make a CSS mock-up appear to work.

## Visual direction and toolkit

**Recommended direction: precision black glass.** Muna should be recognizable by its
silhouette, content continuity, and calm response, not by a different effect on every module.
The distinctive moment is the strip becoming useful content without losing its identity.

These are art-direction proposals, not rendered or approved new themes:

| Direction | Character | Where it fits | Decision |
| --- | --- | --- | --- |
| Precision black glass | Black shell, subtle neutral depth, crisp typography, color from meaningful content | Daily notch and panel | Recommended; closest to current specifications and lowest migration cost |
| Soft graphite | Slightly lifted neutrals, generous reading surfaces, quieter contrast between containers | Settings and longer text workflows | Prototype within Settings only; no automatic light-theme notch |
| Clear floating glass | More background visibility and adaptive material | Optional Island experiment | Defer until native fallback, contrast, and power measurements exist |

The curated toolkit is **React + Vite + Tailwind + React Aria + Motion + Inter + Lucide**,
which Muna already has. Use Radix Colors as a reference for color roles, Geist as the one
font challenger, and custom static SVG for the few illustrations that define the product.
The research does not justify a new runtime dependency for the core shell.

The highest-return polish work is consistent spacing, readable metadata, dependable focus,
good empty/error states, optical icon alignment, and interruption-safe movement. More
frameworks, more transparent surfaces, and more animation are not substitutes for these.

## Typography research

### Font shortlist

| Candidate and primary source | Strength and visual character | Muna recommendation | License/availability |
| --- | --- | --- | --- |
| [Inter](https://github.com/rsms/inter) | Designed for screens; tall x-height, tabular numbers, contextual alternates, and character variants | Keep as the notch default. It already matches the measurements and shared tokens | OFL-1.1; bundle locally with notice |
| [Geist Sans and Mono](https://github.com/vercel/geist-font) | Geometric, restrained Swiss-inspired character; matching mono family for code | Best single challenger for an A/B typography proof. Do not assume marketing specimens establish readability at 12-13 px | OFL-1.1; Sans and Mono are separate choices, not a reason to load both |
| [IBM Plex](https://github.com/IBM/plex) | More distinctive technical voice; Sans, Serif, Mono, true italics, and script-specific families | Consider for a deliberately more technical identity, not as a small cosmetic swap | OFL; script coverage is spread across font assets |
| [Noto](https://github.com/notofonts/latin-greek-cyrillic) | Script-oriented fallback family ecosystem | Add only a verified missing-script family if system fallbacks cannot meet requirements | OFL-1.1 for the inspected family; verify each selected asset |
| [Segoe UI family](https://learn.microsoft.com/en-us/typography/fonts/windows_11_font_list) | Familiar Windows metrics and appearance | Use installed fonts for the native-feeling Settings direction; test Windows 10 fallback explicitly | OS font availability is not redistribution permission |

Do not bundle SF Pro or SF Symbols to obtain an Apple-like result. Do not add a display face,
pixel font, or monospaced timer merely to make the utility look distinctive. Tabular numerals
in the normal UI face are sufficient for stable countdowns.

### Refine the existing font before replacing it

`packages/ui/src/tokens/fonts.css` currently loads normal-style, weight-variable Inter
WOFF2 subsets for Latin, Latin Extended, and Cyrillic. This has concrete implications:

- The package advertises optical-size and italic variants, but that does not prove the
  selected `wght-normal` files contain every advertised axis. Inspect the exact binary
  before claiming that `font-optical-sizing: auto` changes its rendering.
- No italic face is declared in this file. If a feature needs italic emphasis, verify real
  italic assets and fallbacks rather than relying on synthetic slant.
- Keep `font-weight` and `font-variant-numeric` as CSS properties. Character-variant tags
  such as the existing `cv11` and `ss01` are family-specific; do not carry them blindly
  into a Geist or Plex swap.
- Keep the current 400/600 hierarchy and reserve 700 for display values. Thin text on dark
  glass looks fragile at small sizes; animation should not continuously change font weight.
- The current `font-display: block` trades fallback reflow for a possible invisible-text
  interval. Keep this deliberate choice until cold-start and missing-font behavior are
  tested. Do not copy a generic `swap` recommendation without considering shell geometry.
- A CSS font stack is not proof of actual fallback coverage. Check Arabic, CJK, Cyrillic,
  combining marks, and mixed-direction names using the fonts available on the target OS.

For multi-line help or error copy, prototype more generous line height and space, not just
larger containers. Retain compact tokens for single-line utility labels; avoid a global
16 px redesign of a 32 px strip. Any accepted type-token change updates the main spec.

### Font asset measurements

Measured the exact installed files referenced by `fonts.css`, without installing new fonts:

| Asset | File bytes |
| --- | --- |
| `inter-latin-wght-normal.woff2` | 48,256 |
| `inter-latin-ext-wght-normal.woff2` | 85,068 |
| `inter-cyrillic-wght-normal.woff2` | 18,748 |
| Total referenced font assets | 152,072, approximately 148.5 KiB |

These are file sizes, **not** startup transfer, decoded memory, or rendering measurements.
Unicode ranges affect which faces load. Do not preload every subset or add a second whole
family by default. The first typography prototype should compare identical content with the
same sizes and weights before adjusting either candidate.

## Color-system research

### Roles first, palette second

[Radix's scale documentation](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
separates app backgrounds, component states, borders, solid actions, and text. Its
[palette composition guide](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette)
also distinguishes neutral and tinted grays. Borrow that role discipline, not a second set
of tokens mixed into module CSS.

Muna's black and nearly neutral panel surfaces are deliberate. They let artwork, progress,
and status provide color without a blue or purple cast across everything. Keep the existing
semantic tokens as the consumer API. If a role is missing, add it centrally after proving
why the existing ones are inadequate.

| Role | Recommended rule |
| --- | --- |
| Surface/background | Neutral black glass with a guaranteed readable base |
| Primary content | Highest-contrast text; not a brand-color headline |
| Secondary content | Existing readable secondary tone, not tiny or excessively dim type |
| Interactive accent | User accent for active controls; verify both glyph and focus-ring contrast |
| Status | Stable meaning plus label/icon; never color alone |
| Artwork tint | Subtle and bounded by the current design-system cap; never tint text |
| Decorative hairline | May be subtle when it conveys no essential information; do not use it as the only focus/selection signal |

An orange Pomodoro identity and an orange warning need different labels/icons and context.
A user-selected red accent must not make ordinary controls indistinguishable from destructive
actions. Resolve such collisions through explicit roles and distinct treatment, not by
recoloring every module.

### OKLCH is a design tool, not an accessibility guarantee

[CSS Color 4](https://www.w3.org/TR/css-color-4/) defines modern color spaces. OKLCH is
useful when exploring lightness, hue, and chroma, but equal lightness steps do not guarantee
WCAG contrast, and out-of-gamut values can be mapped differently by output conditions.

Keep the repository's current hex/RGB notation unless a coordinated migration has value.
For any experimental ramp, validate sRGB first; add wide-gamut variants only with an sRGB
fallback and actual device evidence. For gradients and album tints, inspect intermediate
colors and the worst text background, not only endpoint swatches.

Radix's documented contrast relationships concern its intended scale/background pairings.
They do not transfer automatically to customized alpha colors over arbitrary wallpaper.
APCA can inform a type proof, but WCAG contrast remains the existing release gate.

### Deeper compositing measurements

The follow-up probe read current dark/light tokens and calculated 30 text combinations:
three text alphas over the base and four individual surface overlays in each appearance.
The candidate 46% alpha is an experiment, not a token change.

| Pair | 40% text | Candidate 46% text | Existing 60% secondary |
| --- | --- | --- | --- |
| Dark panel bottom | 3.7134:1 | 4.6169:1 | 7.3325:1 |
| Dark surface-1 over panel bottom | 3.8151:1 | 4.6826:1 | 7.2409:1 |
| Dark surface-2 over panel bottom | 3.8260:1 | 4.6515:1 | 7.0536:1 |
| Dark surface-3 over panel bottom | 3.7464:1 | **4.4985:1, fail** | 6.6508:1 |
| Dark surface-4 over panel bottom | 3.5339:1 | **4.1801:1, fail** | 5.9938:1 |
| Light Settings base | 2.8184:1 | **3.4174:1, fail** | 5.5971:1 |
| Light surface-4 over Settings base | 2.6668:1 | **3.1813:1, fail** | 4.9327:1 |

**Important:** 46% is not a universal fix. The 4.4985:1 pair fails even if a display rounds
it to 4.50. Using the current secondary tone is the simpler safe starting point for these
sampled readable-text roles. Not every sampled surface currently contains text; these
calculations test token suitability, not seven new rendered defects.

The same script calculated black `--on-accent` text against all eight accent fills in
both appearances: all 16 pairs exceed 4.5:1. The lowest is light purple at 5.0845:1.
That does **not** establish accent-colored text or focus-ring contrast against other surfaces.
Nested overlays, media tints, popovers, forced colors, and rendered Settings remain separate
checks.

## Frontend framework and component comparison

There is no objectively "best-looking framework." React is the rendering layer, Tailwind
is styling infrastructure, and component libraries provide different amounts of behavior
and visual design. None replaces art direction or Windows performance measurements.

| Option and primary source | What it provides | Visual fit and integration cost | Recommendation |
| --- | --- | --- | --- |
| [React Aria Components](https://react-aria.adobe.com/styling) | Unstyled accessible behaviors, state attributes, render props; Apache-2.0 | Complete control of Muna's material, with existing project integration | **Keep** as the behavioral foundation |
| [shadcn/ui](https://ui.shadcn.com/docs/index.md) | MIT open component source and distribution tooling, rather than a conventional imported component library | Good reference for cohesive defaults; copied code and primitive dependencies become maintenance work | Study layout/composition; do not run its generator over Muna |
| [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) | MIT unstyled accessible primitives | Strong alternative foundation, but duplicates React Aria responsibilities here | Consider only for a specific unmet requirement, with explicit review |
| [Base UI](https://base-ui.com/react/overview/quick-start) | MIT unstyled composable primitives | Another capable foundation; portal/lifecycle behavior still needs integration with the notch | Reference, not a parallel control system |
| [Radix Themes](https://www.radix-ui.com/themes/docs/overview/getting-started) | MIT pre-styled controls, global stylesheet, theme provider | A coherent starting aesthetic for a new app, but another visual system inside Muna | Use its playground as a comparison, not a dependency |
| [Fluent UI React v9](https://fluent2.microsoft.design/get-started/develop) | Windows-aligned components with Griffel CSS-in-JS and a provider; MIT code with separate asset caveats | Best reference for familiar Windows Settings behavior, not a drop-in native-material renderer | Borrow conventions; keep current React Aria/Token implementation |
| [Mantine](https://mantine.dev/getting-started/) | MIT component suite and hooks with Vite templates | Useful for feature-dense applications; replacing existing primitives is a substantial migration | Not justified for visual polish alone |
| [Magic UI](https://magicui.design/docs) | Copy-source components aimed primarily at landing pages and marketing | Some good entrance/composition references; many effects serve a different attention budget | Marketing inspiration only; inspect each item's license and behavior |

The current shadcn documentation references Base UI dependencies. Do not assume every
shadcn component or registry item uses the same primitive/version based on older tutorials.
Inspect the actual source before any adoption.

Aceternity was also considered, but the fetched catalog exposed insufficient detail for a
component-level accessibility, license, or performance assessment. It is not an approved
dependency from this research. Attractive gallery examples are not evidence of fit.

Stay with React/Vite in Tauri. SSR, Next.js, a router migration, a CSS-in-JS migration,
or a second animation engine does not inherently improve the pixels in this desktop shell.
Library bundle/CPU rankings were not measured and are intentionally not invented.

## Icons and assets

### Icon shortlist

| Family and primary source | Character and capability | Recommendation |
| --- | --- | --- |
| [Lucide](https://github.com/lucide-icons/lucide) | Clean outline family already used by Muna | **Keep.** Centralize visual sizes/strokes and use static named imports |
| [Phosphor](https://github.com/phosphor-icons/react) | Regular, bold, fill, duotone, and other weights; MIT | Best alternate for a softer or more expressive full icon-system prototype; never sprinkle different weights through the existing bar |
| [Fluent System Icons](https://github.com/microsoft/fluentui-system-icons) | Microsoft regular/filled family, with direction metadata; MIT | Best alternate for a Windows-native identity; compare actual 16/20 px assets, not only large previews |
| [Tabler](https://tabler.io/icons) | Broad outline set based on a 24 px grid and 2 px stroke; MIT | Good alternative catalog, but no demonstrated benefit over existing Lucide |
| [Simple Icons](https://github.com/simple-icons/simple-icons) | Brand identifiers, not general controls | Use only when an integration needs its brand, with per-icon rights review |

Keep icons in `currentColor`, with an accessible name on the control and decorative SVG
hidden from assistive technology. Retain Muna's documented 16/20/24 px sizes and stroke
rules rather than accepting each package's default. Filled states must have a consistent
meaning; use the same family's intended variant or a documented fill-capable glyph.

Do not make icons "pop" by giving every one a colored tile or a hover bounce. Test optical
centering of play triangles and asymmetric glyphs, legibility at 100/125/150/200% scaling,
RTL direction rules, and the full clickable area. Pixel snapping must not introduce
position jumps during a spring.

The [Lucide license](https://github.com/lucide-icons/lucide/blob/main/LICENSE) includes ISC
terms and MIT notices for listed Feather-derived icons; keep the complete notices.
[Simple Icons' disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md)
explicitly says its project-level CC0 does not make every brand icon CC0 or grant trademark
permission. Likewise, Fluent UI's code license does not grant blanket font/asset rights.

### Curated asset policy

| Need | Preferred asset | Why |
| --- | --- | --- |
| Product identity | Original Muna mark and a small consistent set of static SVG illustrations | Distinctive without adding a rendering engine |
| Empty states | Existing outline icon plus useful text/action; custom illustration only for meaningful onboarding | Daily empty states should help, not entertain |
| Artwork and thumbnails | Integration-provided content under that integration's terms; stable fallback icon | Real content supplies richer color than ornamental gradients |
| Progress and charts | Existing DOM/SVG primitives with labels and tabular values | Accessible, themeable, and no new runtime for a small ring |
| Optional sound | Selected [Kenney CC0 assets](https://kenney.nl/support) or original recordings | Locally bundled; preserve silent-by-default behavior |
| SVG preparation | [SVGO](https://svgo.dev/docs/introduction/) as an optional build-time optimizer | Remove export clutter without shipping an optimizer in the app |

For every adopted asset record its origin, version or hash, author, license, required
notice, allowed modifications, and where it is used. Preserve SVG viewBox, necessary IDs,
and intentional strokes during optimization; verify the result at its actual display size.
Third-party SVG must not retain scripts, remote references, or unexpected embedded content.

Do not ship asset-CDN fetches, third-party font requests, marketplace preview files, or
unlicensed product screenshots. An asset pack's download page, runtime license, and
individual artwork license are separate things.

## Experience design

Smoothness is partly a response-time and predictability problem, not just an easing problem.
[NN/g's response-time guidance](https://www.nngroup.com/articles/response-times-3-important-limits/)
supports fast acknowledgment; it does not say every animation should last 100 ms.
Keep Muna's existing distinction between input response and spring settling.

Use [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) to
separate glanceable information from occasional controls. Never use it to hide a recovery
action, inaccessible overflow, or essential status.

| Moment | Desired experience | Concrete design requirement |
| --- | --- | --- |
| First encounter | Understand what the notch does without a tour covering the screen | One concise hint and an obvious keyboard route; avoid auto-expanding repeatedly |
| Idle strip | Recognize state at a glance | Stable slots, no decorative movement, no unexplained colored dots |
| Hover | Feel intentional, not accidentally triggered | Preserve velocity filtering, hover intent, and exit grace |
| Open panel | Understand one useful task immediately | Stable header and controls; prioritize active content over a dashboard of everything |
| Module switch | Keep orientation | Preserve each module's logical state; make active module and heading agree |
| Remote operation | Know whether the action was accepted | Immediate local feedback, honest loading state, explicit success/failure; no optimistic success for failed OS commands |
| Empty state | Know what can be done next | Distinguish no data, disabled integration, missing permission, and unavailable feature |
| Error | Recover without guessing | State the problem and specific next action; keep the action keyboard reachable |
| Dismissal | Return to work without consequences | Escape/outside click remain predictable; no lost draft, focus theft, or surprise reset |

Proposed refinement: keep the source of an action visually related to its result, such as
artwork retaining its identity from strip to panel. Do not force shared-element transitions
between unrelated content just because `layoutId` supports them.

Icon labels should be discoverable through hover **and** keyboard focus. The
[APG tooltip draft](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) describes these
interactions and Escape dismissal but explicitly remains a work in progress. Use the
existing accessible primitive; a tooltip is supplementary text, not a place for buttons
or the only way to access essential content.

For Settings, favor clear ON-state toggle labels, immediate preview with visible failure
handling, and a reliable reset path. Keep typography samples and appearance previews local.
Do not add a settings control for every stylistic decision; curated defaults are part of polish.

## Animation and motion research

### One animation owner per property

Retain Motion for stateful springs and CSS transitions generated from the shared presets for
simple control states. Never let CSS, Motion, and another engine simultaneously own the same
transform or opacity. Separate shell geometry from inner content choreography.

[Motion's performance guide](https://motion.dev/docs/performance) distinguishes layout,
paint, compositing, and hardware acceleration. `transform` and `opacity` are safest, but
"GPU accelerated" does not mean free: a large filter still creates large rendering work.
Muna's isolated real-width/height shell remains a deliberate exception that needs profiling.

| Tool and primary source | Appropriate job | Muna decision |
| --- | --- | --- |
| [Motion](https://motion.dev/docs/react-layout-animations) | Interruptible React transitions, shared identity, motion values | Keep; reuse `@muna/ui/motion`, not literal tutorial values |
| CSS transitions / Web Animations | Simple bounded state changes with explicit cleanup | Use through existing patterns; do not create a competing timing system |
| [GSAP](https://gsap.com/pricing/) | Elaborate timelines and coordinated scenes | No demonstrated core-shell need; not a smoother default just because it offers more tools |
| [Rive web runtime](https://github.com/rive-app/rive-wasm) | Designer-authored interactive vector scenes with JS/WASM and canvas | Only a future, lazy-loaded onboarding experiment if a static SVG cannot explain the interaction |
| [Lottie web](https://github.com/airbnb/lottie-web) | Playback of authored vector animation with controllable loop/autoplay | Optional one-shot illustration, not the state machine or always-mounted status icon |

Verified licensing matters here: the inspected Rive web runtime and Lottie web code are
MIT, not the editor/marketplace license and not every Lottie-platform license. GSAP's
official page says it is now free, while its
[software license](https://gsap.com/community/standard-license/) retains restrictions,
including visual-animation-builder competition. "Free" is not "MIT." Check the exact
version and bundled artwork before adoption.

Rive's [runtime parameters](https://rive.app/docs/runtimes/web/rive-parameters) expose
autoplay, asset loading, and CDN-related controls. Lottie exposes playback, pause/stop,
and destruction controls. Neither may assume that leaving an offscreen canvas mounted
meets Muna's idle budget. Bundle any WASM, animation file, images, and fonts locally;
turn off playback under reduced motion and release resources when the owning view disappears.
Do not install either merely for a loading spinner.

### Motion direction for a standout utility

Make **continuity** the signature: silhouette leads, content follows, and controls stay
anchored while the useful area changes. Secondary motions should be quieter than the shell.

| Category | Keep or refine | Avoid |
| --- | --- | --- |
| Shell | Existing physics springs; interruption at any point; top-center anchoring | Longer durations to mask dropped frames; key-based remount/restart |
| Content | Small, meaningful entry; large-wrapper recipe without blur | Nested scale/blur on entire module bodies |
| Dismissal | Existing non-bouncy collapse with coordinated exit | Celebration bounce on close, failure, or mute |
| Repeated controls | Immediate state cue and restrained shared press response | Staggering or replaying an entrance on every interaction |
| Value changes | Tabular numbers; interpolation only when useful | Rolling every live percentage digit |
| Loading | Stable layout, honest status, hidden-state cleanup | Infinite skeletons behind a closed panel |
| Reduced motion | Opacity-only content and persistent state cues | Treating reduced duration alone as sufficient |

Performance capture should separate input-to-first-feedback, first-frame hitch, frame
distribution, settling, and idle cleanup. A good average FPS can hide a bad first frame.
Review real-time playback first, then slow a recording to inspect clipping and discontinuity.
Reduced-motion output must be reviewed as its own design, not merely as a checkbox.

## Prototype and selection protocol

The purpose is to choose what works, not to declare a winner from a vendor screenshot.
No font swap, new color ramp, or alternative component library was browser-benchmarked in
this extension.

1. **Build one comparison surface in Storybook.** Use the same media card, calendar list,
   long title, error, and control rail. Compare current Inter against Geist; keep everything
   else constant before adjusting typography.
2. **Evaluate complete states.** Compare precision black glass and the Settings-only
   graphite direction on dark, white, and busy backgrounds, with long translations, RTL,
   missing artwork, loading, and keyboard focus.
3. **Review interaction, not just stills.** Open, reverse mid-morph, switch modules,
   dismiss, and repeat using keyboard and reduced motion. Record with identical dimensions.
4. **Measure before accepting.** Reuse the current native CPU/RSS/FPS gates, calculate
   final composited contrast, and measure actual bundle/font changes. Stop if a new dependency
   offers only a gallery effect without a user benefit.

Suggested formative tasks are identifying the active module, finding an overflowed module,
reading a long track name, recovering from a connection error, and dismissing the panel
without losing work. Record completion, mistakes, hesitation, and preference separately.
Recruit keyboard-only and motion-sensitive participants when possible. This research
includes **no completed user study**, preference score, or empirical "most elegant" ranking.

Select a candidate only when it preserves task success, readability, and performance.
If preference is split and neither has a measurable advantage, retain the existing system.
The deliverable should be a few better primitives and clear rules, not a dependency collection.

## Local reference repository adoption

### Inspection boundary and provenance

The five user-provided local checkouts were inspected on 2026-09-28. No reference application
was launched, built, installed, or modified. The findings here concern source-backed behavior
and composition, not measured animation quality or a full product audit.

| Local folder under `C:\Users\Shega\Documents\GitHub` | Inspected revision | Root license |
| --- | --- | --- |
| `DynamicNotch` | `f35eeb7b95ba4e54828d83c980bf01ef2ab11528` | GPL v3 text |
| `boring.notch` | `d58240cc160d5e54da1a8a5925e095d067a8e1e0` | GPL v3 text |
| `Nectar` | `42609f78e301f98ab4f85a2fa3efe09864979a7e` | GPL v3 text |
| `bloom` | `0a298759c7df81fd82bd0bec65bf4a4004de293d` | GPL v3 text |
| `MenuScores` | `318b96b6af462675c79f3659a8a312a0b8a858cc` | GPL v3 text |

Paths in each repository's subsection are relative to that repository, not Muna. Line
references apply to these revisions. Nectar explicitly describes its Bloom ancestry in
`README.md:34-35`; do not count inherited features as two independent design validations.

**Adopt interaction ideas, not source wholesale.** All five roots carry GPL terms. Copying
or closely translating implementation code requires a license-compatibility and compliance
decision; Muna's current package metadata is `UNLICENSED`, not a grant of GPL compatibility.
Independently implement requirements in Muna's existing architecture. Asset, logo, font,
vendored-code, and data-provider rights need separate review. MenuScores' vendored
DynamicNotchKit has its own MIT license; that does not relicense the surrounding application.

### What is already in Muna

Do not mistake the feature catalog for shipped functionality. At this baseline,
`apps/desktop/src/modules/registry.ts:31` initializes an empty frontend module registry.
The shell, settings, onboarding, shared UI, and built-in activity sources have implementations;
most feature panels remain specifications.

| Muna area | Baseline status | How references should help |
| --- | --- | --- |
| Morphing shell, hover intent, user pin, field-focus hold, module-bar primitives | Implemented infrastructure | Refine lifecycle and interruption cases, not replace the shell |
| Activity/notice scheduling, priorities, same-ID notice refresh, panel suspension | Implemented foundation | Extend dismissal/restoration semantics only where missing |
| Shared springs and flared silhouette | Already specified and implemented; boring.notch is an existing motion reference | Do not present its open/close springs as a new discovery or copy different literals |
| Media, calendar, Pomodoro, shelf, dashboard, HUD | Existing module specs, not completed feature panels here | Use reference compositions to make those specs more concrete |
| Settings/onboarding with live application | Implemented foundation | Add focused activity/control previews, not another settings framework |
| Sports scores or a general download activity source | Not standalone modules in the current catalog | New optional scope requiring a separate product and integration decision |

Effort labels below are relative: **S** is a localized UI/logic refinement, **M** spans a
module and shared behavior, and **L** adds substantial platform/provider integration.
They are not time estimates.

### Best contribution from each project

| Project | Best thing to adopt | What makes it useful |
| --- | --- | --- |
| DynamicNotch | Activity lifecycle rules, real settings previews, priority editing | A reliable system for deciding what appears, not just another animation |
| boring.notch | Shared artwork identity and interaction-safe shelf/share workflows | The notch remains one understandable object while useful actions happen |
| Nectar | Configurable status slots, richer calendar views, timer/stopwatch composition | More utility in a bounded panel without showing every feature at once |
| Bloom | Compact media anatomy and an expandable, measured audio-mixer surface | Clear information hierarchy and concrete Windows hit-region integration |
| MenuScores | Symmetric compact values, state-dependent detail, respectful auto-pinning | A strong pattern for glanceable changing information and meaningful updates |

### DynamicNotch: a richer activity system and preview-driven settings

| Adoptable pattern | Source evidence | Muna adaptation and benefit | Effort |
| --- | --- | --- | --- |
| Separate live content from temporary interruptions | `DynamicNotch/Core/NotchEngine/NotchEngine.swift:85-177,277-405`; `DynamicNotch/Core/NotchEngine/Models/NotchContentRegistry.swift:7-151` | Keep Muna's scheduler; extend and test restoration, duplicate replacement, and explicit dismissal semantics. An interruption should return to the right activity without replaying stale content | M; partly existing |
| Settings show the same silhouette users will get | `DynamicNotch/Features/Settings/Shared/Components/SettingsNotchPreview.swift:5-118` | Reuse `NotchSurface` in a bounded preview of geometry, material, and content. Compare light/dark/busy backgrounds without creating another native window | S; builds on existing onboarding previews |
| Activity priority is understandable and editable | `DynamicNotch/Features/Notch/Settings/ActivityPrioritiesSettingsView.swift:6-97` | Show module icon, name, default explanation, and bounded priority adjustment in Live Activities settings. Keep HUD/system priority rules explicit | S-M; priority boosts are already specified |
| Compact download progress expands into useful detail | `DynamicNotch/Features/Download/Views/DownloadNotchView.swift:6-72`; `DynamicNotch/Features/Download/Views/DownloadExpandedNotchView.swift:6-100` | For future download/file-operation activities: icon plus progress in the strip; filename, destination, speed, and progress in the panel. Start with Muna-owned file operations before browser integrations | M for existing operations; L for new browser/provider sources |
| A primary item is chosen by update recency, with additional-item count | `DynamicNotchTests/Features/Download/DownloadViewModelIntegrationTests.swift:5-77` tests primary selection and additional count | Present one useful transfer summary rather than expanding a card for every transfer. Keep aggregate state accessible and deterministic | M; future transfer module |
| Motion has separate semantic roles | `DynamicNotch/Features/Notch/NotchAnimations.swift:8-69` | Preserve distinct shell open/close, content conversion, and transient-notice policies using Muna's presets. A settings preview can demonstrate them without exposing raw damping knobs | S; vocabulary already present |
| A pull previews intent; release commits the action | `DynamicNotch/Shared/UI/Modifiers/NotchMouseSwipeModifier.swift:179-283` starts inside the notch, reports stretch, and checks thresholds on release | An optional gesture can provide reversible feedback before dismiss/restore commits. Use Motion values, pointer capture, cancellation, and a keyboard equivalent; never scale all panel text or move the HWND per frame | M-L; optional refinement |

**Suggested composition:** an activity card uses a fixed source identity, a primary fact
(track, file, task, timer), a status/progress region, and a small context/action row.
Live Activities settings preview how each card collapses into the existing two strip slots.
The activity queue remains the owner; modules do not independently pop open the whole panel.

**Do not port the native implementation.** SwiftUI/AppKit geometry, first-mouse handling,
macOS hardware-notch detection, and private window integrations need Windows equivalents.
Keep Muna's maximum-sized transparent HWND and animate actual CSS shell width/height inside
it; do not resize the native window each frame. A transition queue must coalesce stale work,
not lock out a hover reversal or Escape until an animation finishes.
The reference restores by stable ID and last-dismissed history
(`NotchEngine.swift:178-215,313-337`), but incoming live publishes clear dismissal markers
(`:111-152`). For Muna, define when a genuinely new event may resurface a dismissed activity;
an ordinary metadata refresh should not erase the user's choice.

Download monitoring is not automatically a browser download API on Windows. A watched folder
does not reliably reveal browser pause/cancel/progress. Admit those controls only when an
explicit integration can perform them. The expanded reference download view uses a periodic
TimelineView; Muna must independently manage visible progress rendering and backend lifecycle.

### boring.notch: interaction continuity and a useful shelf

The strongest lessons are continuity between compact and expanded media, preserving an
interaction while a native picker is open, and treating the shelf as a real file workflow.

| Adoptable pattern | Source evidence | Muna adaptation and benefit | Effort |
| --- | --- | --- | --- |
| Artwork keeps its identity across states | `boringNotch/ContentView.swift:398`; `boringNotch/components/Notch/NotchHomeView.swift:83-95` use the same album-art matched geometry | Give strip art and panel art a shared identity; retain old art until new art is decoded. The transition has an understandable origin | M; media spec already calls for stable artwork |
| Auto-close pauses for external interactions | `boringNotch/models/SharingStateManager.swift:19-64`; `boringNotch/models/BoringViewModel.swift:200-206`; `boringNotch/ContentView.swift:543-556` | Extend the shell with explicit, idempotently released interaction holds for a share picker, drag-out, or device popover. Pointer exit must not destroy the action being completed | M; extend existing focus/user pin, not another independent state machine |
| Optional media actions live around a stable transport core | `boringNotch/models/MusicControlButton.swift:11-44`; `boringNotch/components/Notch/NotchHomeView.swift:224-236,250-310` | Keep previous/play/next stable; add capability-aware secondary actions. Use explicit overflow rather than silently dropping important controls when space tightens | S-M; media module |
| Configuration previews the actual control layout | `boringNotch/components/Settings/MusicSlotConfigurationView.swift:36-164` | A preview plus control palette and reset makes layout editing understandable. Add keyboard add/remove/reorder paths; do not make it drag-only | M; optional media settings refinement |
| Immediate share destination beside persistent storage | `boringNotch/components/Shelf/Views/ShelfView.swift:17-33`; `boringNotch/components/Shelf/Views/FileShareView.swift:26-39,95-122` | Put a named Share action beside Shelf storage inside the existing panel. Show which target will receive the drop and an honest busy/result state | L for native share/drag integration; already planned in Drop Actions |
| Familiar selection and prebuilt drag previews | `boringNotch/components/Shelf/ViewModels/ShelfSelectionModel.swift:20-64`; `boringNotch/components/Shelf/Views/ShelfItemView.swift:74-91,161-168` | Ctrl-toggle and Shift-range selection, cached thumbnails, and drag preview prepared before pointer movement. Keep order deterministic and expose keyboard actions | M-L; shelf spec refinement |
| A small date strip supports the adjacent agenda | `boringNotch/components/Calendar/BoringCalendar.swift:30-85,92-128` | Offer an optional week/date strip in a dashboard-sized calendar widget; preserve today/selected distinction and a keyboard route to every date | M; not a replacement for the planned full calendar view |
| HUD communicates mute as a state, not just zero progress | `boringNotch/components/Live activities/InlineHUD.swift:69-106` | Keep mute glyph/text alongside the level. Updating volume should not restart the shell entrance | M; existing HUD spec |

**Suggested composition:** media artwork and transport are the primary column; an optional
agenda occupies a secondary column only when there is room. Shelf has an explicit share
target and a keyboard-navigable item area. The module bar remains below Muna's panel,
not inside the collapsed strip.

**Do not import its rendering costs or quirks.** The media view applies 40/50 px artwork
blurs and a 30 px body blur (`NotchHomeView.swift:54,80,465`), exceeding Muna's blur rules.
Its visualizer uses random bar targets
(`boringNotch/components/Music/MusicVisualizer.swift:57-88`);
do not label those as real audio analysis. The marquee repeats indefinitely
(`boringNotch/components/Live activities/MarqueeTextView.swift:65-82`), and the inspected Swift sources
did not expose a reduced-motion guard under the searched API names.

Likewise, retain Muna's visible broken-file state rather than silently dropping missing
shelf items as `ShelfStateViewModel.swift:91-111` does. Native AppKit sharing, Quick Look,
SF Symbols, macOS haptics, and window levels are not Windows implementations. The interaction
hold should have lifecycle-based release, not copy the share delegate's two-second timeout.

### Nectar: configurable compact utility and richer calendar/timer panels

Nectar and Bloom both use React 19, TypeScript, Tauri v2, Tailwind v4, Lucide, and
`framer-motion`; their manifests also include dnd-kit. Nectar declares Motion 12.38 and
Bloom 12.43 ranges (`package.json:16-38` and `:17-39`). These are similar stacks, not
drop-in components for Muna's `motion/react` imports, shared presets, and typed IPC.

| Adoptable pattern | Source evidence | Muna adaptation and benefit | Effort |
| --- | --- | --- | --- |
| A visible editor assigns widgets to left/right regions | `src/components/StatusWidgetConfig.tsx:1-33,195-235,300-350`; `src/Settings.tsx:133-156` | Show the strip's existing leading/trailing slots as assignment targets, with palette, preview, reset, and keyboard operations. Do not expand Muna into an always-visible multi-widget toolbar | M; new configuration refinement |
| Empty drop zones remain targetable | `src/components/StatusWidgetConfig.tsx:323-329` handles collision fallback using the dragged center | Test empty and narrow targets when implementing dashboard/shelf editors; preserve explicit drop affordances and keyboard equivalents rather than copying sensor logic | S-M within an editor |
| Calendar switches between month, week, day, and agenda | `src/components/NotchCalendar.tsx:57-151` | Use the existing calendar module's panel; show only useful view controls, with Today/navigation/Open calendar. Disconnected state must explain missing event data, not silently imply a complete calendar | M UI; L provider integration |
| Calendar density is summarized before detail is revealed | `src/components/NotchCalendar.tsx:158-250` shows up to three dots and selected-day event summary with a more/open path | Combine a month grid with a selected-day agenda and explicit overflow. Keep non-color event counts/names available | M; calendar composition refinement |
| Timer and stopwatch share a compact surface | `src/components/NotchClock.tsx:52-180` | Add an optional Stopwatch tab to the future timer module, with Start/Pause, Lap, Reset, and recent laps. Keep Pomodoro work/break cycles distinct from stopwatch semantics | M; stopwatch is new optional scope |
| Duration can be entered inline rather than through another dialog | `src/components/NotchClock.tsx:112-143` | Add labeled duration entry and presets. Make parsing unambiguous with an example and localized resolved duration; validate before starting | S-M; timer UX refinement |

**Suggested composition:** Calendar has a compact header, a month/week view, then the
selected-day agenda; extra detail is deliberate. Timer has an explicit mode selector, one
large tabular value, one primary Start/Pause control, secondary Reset/Lap, and a concise
recent-history region. Slot configuration belongs in Settings, not the active strip.

**Do not copy inaccessible or persistent animation.** Calendar cells in
`NotchCalendar.tsx:203-216` use clickable `div` elements; use React Aria/date-grid keyboard
behavior in Muna. Timer completion blinks indefinitely in `src/App.css:273-278`; Muna should
show a persistent readable finished state and its scheduled notice instead.

Nectar's compact media player has artwork rotation and five visualizer bars
(`src/CompactMediaPlayer.tsx:182-224`), but the three-row anatomy is substantially shared
with Bloom. Adopt the anatomy once; do not infer independent validation or better performance
from the fork. No reduced-motion guard was found in the selected scene implementations.

### Bloom: compact media and measured control-surface expansion

| Adoptable pattern | Source evidence | Muna adaptation and benefit | Effort |
| --- | --- | --- | --- |
| Media has a clear three-row structure | `src/CompactMediaPlayer.tsx:197-380` | Row 1: artwork/title/artist; row 2: elapsed/seek/remaining; row 3: stable transport plus volume/output. Add lyrics as an optional secondary region, not permanent clutter | M; existing media spec |
| Secondary volume control expands in place | `src/CompactMediaPlayer.tsx:352-380` | Reveal a compact volume row on explicit action while keeping transport positions stable. Reuse `switch`/`content` presets and React Aria Slider | S-M; media refinement |
| Geometry accounts for actual content variants | `src/App.tsx:1819-1840` distinguishes month rows, compact progress, and volume expansion | Give each module a measured natural size with min/max bounds and scroll/overflow rules. Do not hard-code a height that clips a six-row month or translated labels | M; extend existing shell measurement |
| An expanded mixer arranges sessions in a responsive grid | `src/Overlay.tsx:343-465` | Optional per-app audio controls within the existing HUD/audio panel: adaptive columns, mute/level per session, explicit close, no second shelf/modal | L including Windows audio-session integration |
| Interactive bounds follow expanded controls | `src/Overlay.tsx:240-261`; `src-tauri/src/services.rs:2389-2400` | Publish the actual visible control region and clear it on dismissal. Extend Muna's existing current/target hit regions for relevant popovers | M; largely an existing architectural principle |
| Requested previews need not block the panel | `src-tauri/src/utils.rs:745-786`; `src-tauri/src/commands.rs:2736-2765` | Use bounded, cached thumbnails and an explicit no-preview state. For Shelf, prefer the planned file thumbnail API; window capture is a separate optional feature | M for file thumbnails; L for window previews |

**Suggested composition:** media opens as the three-row player; selecting volume reveals
the small inline row, while an explicit mixer action reveals an adaptive session grid.
Keep the controlling source and its result visually connected inside Muna's panel.

**Do not adopt the full dock/taskbar replacement.** Bloom's notch/dock/overlay/settings
windows serve a different product. Its dock expands hit regions with fixed 500/320 px
margins (`src/Dock.tsx:215-223`); Muna should measure actual interactive bounds, not create
large invisible click-capture regions. Its focused-window preview warming
(`src-tauri/src/services.rs:476-552`) is not suitable as a default idle task.

Likewise, do not transfer the shell blur/ambient animation in `src/App.tsx:1866-1965`,
hover-driven module switching, or string-valued settings model. Keep Muna's typed settings,
explicit module selection, visibility gating, and authoritative Rust state.
The source's animated `pointerEvents` value is not a substitute for deterministic native
hit-testing. Preserve the useful lifecycle idea without copying that mechanism.

### MenuScores: meaningful live changes and respectful activity promotion

This is the most useful reference for a **new optional feature**, but its best design ideas
also improve the existing Live Activities system without adding sports at all.

| Adoptable pattern | Source evidence | Muna adaptation and benefit | Effort |
| --- | --- | --- | --- |
| Compact values are balanced around a quiet center | `MenuScores/Views/Notch Views/Leading.swift:21-67`; `MenuScores/Views/Notch Views/Trailing.swift:21-72` | A future score activity can use fixed participant identity and tabular values. Generalize only the layout principle for meaningful paired facts; do not turn every activity into a scoreboard | M; sports would be new scope |
| Score changes notify, initial binding does not | The same leading/trailing views suppress an initial update after game-ID changes, then trigger change alerts | Diff state by stable identity before sending a notice. Initial load, reordering, or reconnect must not masquerade as a new event | S-M; scheduler/source reducer refinement |
| Center detail depends on event state | `MenuScores/Views/Notch Views/Expanded.swift:93-216` switches among scheduled time, live period/clock, and Final | Make activity details semantically different for upcoming/running/completed. Avoid a progress bar or ticking clock that conveys the wrong state | M; applicable to timer/calendar/file operations |
| One latest-event line gives an update context | `MenuScores/Views/Notch Views/Expanded.swift:218-270` renders last-play text and a participant marker | Add a concise latest change to the existing activity card when useful; retain a readable full-detail path instead of mandatory marquee | S-M |
| Favorites influence automatic pinning, without overriding dismissal | `MenuScores/Favorites/FavoritesManager.swift:255-259,429-512` | Let a user focus an activity or prefer a source; suppress a manually dismissed item until a defined meaningful change. Do not constantly reclaim the strip from explicit user selection | M; builds on focused activities |
| Refresh emits transitions rather than repeated snapshots as notices | `MenuScores/Managers/RefreshManager.swift:61-255` checks pre/live/post changes | Keep backend source reducers responsible for first-start/completion transitions. Update unchanged cards in place; coalesce same-ID updates through Muna's queue | M; existing architecture, richer tests |
| Choose presentation explicitly | `MenuScores/Views/Sport Views/Football.swift:43-139` offers pin targets and open-source actions | In an expanded activity, expose Focus in strip, Unfocus, and Open source when supported; preserve a clear route to the source application | S-M; Live Activities expanded view already planned |

The vendored kit offers two additional composition lessons:
`DynamicNotchKit/Sources/DynamicNotchKit/Views/NotchView.swift:6-151` measures compact sides
and offsets their composition to preserve centering despite unequal widths.
`DynamicNotchKit/Sources/DynamicNotchKit/DynamicNotch/DynamicNotchTransitionConfiguration.swift:7-48`
separates opening, closing, conversion, and whether an intermediate hide is needed.
Test asymmetric slot contents in Muna and avoid an unnecessary empty/black flash on a
same-activity update. Do not import the kit's blur/scale recipe into the shell.

**Suggested sports composition, if approved:** team abbreviation/mark and score on each
side; scheduled time/live period/final status centrally in the expanded card; a single
latest-play line below; Focus/Open source actions in the footer. Reduced motion preserves
the changed score and status with no rolling digits or marquee. A textual strip summary
can fit today's contract; two rich team-mark slots would require an explicit contract change.

**Do not copy provider assumptions.** ESPN-shaped models, external logo URLs, competitor
array indexes, and sport-specific clocks need normalized data and reviewed provider/brand
terms. `RefreshManager.swift:257-353` manages a shared refresh registry and stops its timer
when empty, but it is still polling, not proof of zero hidden work. Poll only enabled
sources at a justified cadence with cancellation/backoff/stale status.

Avoid the large hard-coded league/view-model list in
`FavoritesManager.swift:194-286`; Muna already has a module boundary. Do not add a second
generic Activity Timeline module when the existing Live Activities expanded view can serve
the purpose. Sports remains a proposal, not a silent addition to the roadmap.
The reference's dismissed-favorite suppression is session state, not proof of persistence
across restarts. Muna must explicitly decide the lifetime of such a dismissal.

### Concrete adoption order and acceptance checks

Keep the HIGH baseline fixes in this report first. Then take these references in a small
number of independently verifiable slices:

| Order | Slice | Reuse or extend | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | Interaction-safe shell and activity updates | Shell machine plus existing scheduler; DynamicNotch/boring.notch/MenuScores semantics | Open picker/drag out, leave shape, cancel/finish; release every hold exactly once; reverse mid-morph; initial refresh sends no false notice |
| 2 | Media composition | Existing media spec and UI primitives; Bloom anatomy plus boring.notch identity continuity | Artwork delayed/missing, unsupported seek, long title, narrow width, keyboard transport, reduced motion; no hidden visualizer |
| 3 | Live Activities settings and expanded cards | Existing priority/focus model; DynamicNotch preview/editor and MenuScores update semantics | Preview matches actual shell; default priority is recoverable; focused item survives routine refresh; dismissed item does not immediately return |
| 4 | Calendar/timer utility | Existing modules; Nectar's selected-day summary and inline input | Six-row month, no account, offline cache, long events, full keyboard date navigation, unambiguous duration, sleep/resume correctness |
| 5 | Shelf/share | Existing shelf/drop specs; boring.notch selection/workflow plus measured hit regions | Native drag-in/out, multi-select, missing file, failed share, Escape, no click-through holes or invisible catch areas |
| 6 | Optional extensions | Stopwatch, per-app audio mixer, browser download source, sports scores | Separate spec and opt-in provider/platform integration; license review; unchanged idle budget |

Potential shared additions are an activity-preview fixture, explicit shell interaction-hold
events, capability-aware transport rows, and a bounded thumbnail cache. These are proposed
design seams, not names of components already shipped. Reuse existing `PanelChrome`,
`NotchSurface`, `Text`, `Slider`, `ProgressTrack`, and `EmptyState` before adding abstractions.
No module should import another module just to compose the dashboard.

### Reference validation limits

The inspection found source-level integration tests in DynamicNotch, including
`DynamicNotchTests/Features/Download/DownloadViewModelIntegrationTests.swift:5-77`
(monitor starts once, started/stopped events, primary selection, preview restoration) and
`DynamicNotchTests/Features/Notch/NotchEventCoordinatorIntegrationTests.swift`
(notification gating and activity changes). Transition-metrics tests are model assertions,
not frame-rate measurements.

Nectar and Bloom have Rust unit tests in selected services; Bloom's instructions document
the absence of a frontend test script. MenuScores' inspected tests are generated
placeholder/launch scaffolding. No dedicated boring.notch automated suite was identified
by the inspected test-file search; its `TestView.swift` is not evidence of one.

**None of those tests was run here.** No local reference has been certified for accessibility,
smoothness, battery use, or Muna's CPU/RSS limits. The adoption recommendations are based
on source, not new screenshots or recordings. Reference checkouts stay unchanged; only this
Muna research document is extended for this comparison.

## Ranked findings

Locations refer to the baseline above. Recommendations are not fixes already applied.
Repeated symptoms are consolidated by root cause.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Colors | `packages/ui/src/primitives/module-bar.css:16`; `apps/desktop/src/styles.css:9` | `background: var(--surface-2)` over transparent app ancestors; active glyph is white | Paint the documented `--surface-2` over `--notch-black`, then check every glyph and focus color | White-backdrop browser experiment makes the bar/glyphs disappear; selected glyph pair is 1.0000:1, below the 3:1 non-text requirement |
| HIGH | Colors | `packages/ui/src/tokens/tokens.css:23`; `packages/ui/src/primitives/text.stories.tsx:47`; baseline `docs/05-design-system.md:73` | White at 40% is offered for 12 px text; the Tones story disables the contrast rule | Use the existing secondary tone for readable text, or review a tertiary-token correction across all surfaces; remove the rule exception only after the pair passes | Measured 3.7134:1 on panel bottom versus 4.5:1 required; unrestricted axe confirms a serious violation. This is an already-documented gap, not newly introduced |
| HIGH | Layout | `packages/ui/src/primitives/module-bar.tsx:164`; `packages/ui/src/primitives/module-bar.css:12`; `apps/desktop/src/shell/shell-geometry.ts:62` | Fixed 640 px bar capacity and a 720 px minimum shell panel | Derive bar capacity from available inline size; keep its pager reachable; bound panel geometry by usable space and synchronize hit regions | At 320 px, both module-bar fixtures produce a 672 px document; controls, including More modules, lie outside the viewport. Native small-work-area clipping remains a separate unverified risk |
| HIGH | Typography | `packages/ui/src/primitives/panel-chrome.tsx:49-54`; `packages/ui/src/primitives/text.css:94-106` | Title and subtitle truncate without a visible full-value reveal | Prefer wrapping with an adaptive header; if compact truncation is essential, provide an accessible full-text disclosure | LongContent measures title 560 px in 272 px and subtitle 423 px in 272 px. Full strings remain in the accessibility tree, but sighted users cannot read them in this fixture |
| HIGH | Layout | `packages/ui/src/primitives/panel-chrome.css:35-42` | Header chips have `overflow: hidden` and shrink behind a long heading | Preserve chip legibility by wrapping/reflowing the header; use explicit overflow disclosure if needed | LongContent screenshot cuts the Context chip to a partial label with no reveal cue |
| MEDIUM | Accessibility | `packages/ui/src/primitives/icon-button.css:29-33`; `packages/ui/src/primitives/panel-chrome.css:46-52` | 28 px buttons extend to 36 px hit areas at a 4 px visual gap | Keep effective areas disjoint, preferably by increasing rail spacing to the existing 8 px token; update the header spec together | Browser-derived pseudo-element bounds overlap by 4 px between Pin and Collapse; visual targets themselves exceed the AA 24 px baseline |
| MEDIUM | UI polish | `apps/desktop/src/shell/notch-window.tsx:619-623`; `packages/ui/src/motion/presets.ts:154-168` | Full-width module wrapper always uses `contentRecipe.enterFrom`, including `blur(5px)` | Use `enterFromLarge` for the module wrapper; keep the blurred recipe only on bounded small elements | The wrapper can span the 720-1000 px panel although blur is limited to 320 x 160 px. This is a confirmed recipe/budget mismatch, not measured proof of dropped frames |
| MEDIUM | Writing | `packages/i18n/src/locales/en.json:13-16`; `apps/desktop/src/shell/panel.tsx:72-81` | "Nothing to show yet" and "Modules appear here as they are added." with no action | Distinguish disabled modules from an empty registry; for disabled modules, offer a wired Open settings action | The current empty state does not tell someone how to proceed. Do not offer an enable action when no modules exist in this build |

The shared token and material fixes should lead the work because they improve many states
at once. The unmeasured native performance and focus checks below are gaps, not invented
failures.

## Final implementation skill

**Name:** Muna glass and motion.
**Use when:** implementing or refining a notch, island, panel, module bar, or shared control.
**Output:** a bounded change, matching Storybook states, updated specifications, and evidence.

### Read and constrain

Read the design and motion specifications before editing. Inspect the actual component,
its states, its module binding, and its tests. Identify the material owner, measurement
owner, and focus owner. Fix the shared cause rather than adding per-module overrides.

Project specifications take precedence over generic aesthetic recipes. In particular,
do not import another skill's literal spring durations, stagger values, font smoothing,
or icon weights into Muna. Accessibility failures still require correction.

Consult the [curated toolkit](#visual-direction-and-toolkit) before proposing dependencies.
Reuse first; prototype a challenger only for a named shortcoming. Inspect the license of
the exact asset, keep third-party notices, and make no runtime network request for decoration.
Never present package claims as measured Muna performance or a preference study.

### Build the material from the outside inward

Keep the collapsed notch pure black. Use `NotchSurface` for silhouette, clipping,
hairline, and shadow; do not rebuild these in modules. Keep panel content opaque enough
to read independently of wallpaper. Restore the module bar's missing black base.

Reuse the existing panel gradient, `--catch-light`, three shadow roles, and surface fills.
Cards and rows get no extra shadow. A selected control needs a lasting fill, icon, or label,
not just an animation. Avoid nested glass, neon borders, decorative gradients, and noise loops.

Use the current concentric radii: panel 28, inset 16, card 12; preserve the 8 px inner floor.
Any deliberate material/token change must update `docs/05-design-system.md` and code together.

### Make motion coherent, not slower

Keep one real-size shell node anchored at the top center. Preserve physics springs so
retargeting is interruptible; never remount the shell to restart its entrance.
Do not replace the shell with a scaled bitmap or FLIP-scaled text.

| Interaction | Existing recipe to reuse |
| --- | --- |
| Expansion | `expand`; content follows via `timings.contentEnterDelayMs` |
| Collapse | `collapse`; preserve the centralized content/shape exit choreography |
| Module change | `switch` for height and indicator, `content` for entry |
| Press | `press`, scale 0.96; static active/pressed feedback remains |
| Pointer-following value | Motion values and `interactive`, not React state per frame |
| Reduced motion | Provider plus opacity-only content recipes; no blur, bounce, rise, or scale |

Use the large content recipe on large wrappers. Do not animate box shadows, large blur,
or squircle path generation. Keep masks at rest and animate only the established geometry.
High-frequency actions should not gain staged entrances. Stop timers, shimmer, and
waveforms when hidden; mounted reduced-motion and hidden-state behavior need separate checks.

### Preserve clarity

Retain Inter/Segoe and the semantic type scale; use weight and spacing instead of extra
colors. Keep changing numbers tabular. Readable secondary text uses `--text-2`;
do not treat placeholders as disabled text to excuse insufficient contrast.

Keep long titles, statuses, chips, and recovery actions reachable. Use logical properties
and content-driven widths. Check 320 px, actual 200% zoom, RTL, and realistic translated
strings; a desktop-only product still has small logical work areas at high scaling.
Do not shrink the whole interface with a transform to make it fit.

Use React Aria primitives, accessible names, visible focus, and non-overlapping targets.
Preserve the non-modal panel behavior; do not add a focus trap. Keep errors recoverable,
and keep actionable/error notices available long enough to act rather than auto-dismissing.

### Prove the change

Capture before/after on identical content and backgrounds. Run focused unit tests and
typechecks, then unrestricted accessibility checks. Show default, empty, loading, error,
long content, RTL, focus, narrow, reduced-motion, and contrast states.

For a visual PR, attach a recording of expand, interrupted reversal, module switch,
collapse, and reduced motion. Verify native click-through and focus separately from DOM tests.
Reject a claimed performance pass if the report has no real measurements.

## Suggested implementation order

1. **Readability and geometry:** restore the bar base; resolve tertiary text; adapt overflow;
   fix long headers/chips and rail hit areas. Add regression cases for each measured failure.
2. **Motion discipline:** remove large-wrapper blur; verify interruption and mask restoration;
   compare real shell recordings rather than relying on the smaller primitive demo.
3. **Optional native glass spike:** only after the first two pass, evaluate an opt-in Island
   backdrop with Rust-owned capabilities, solid fallbacks, and explicit performance evidence.

Native glass is not a prerequisite for an elegant release. Any experiment must test Windows
transparency off, contrast themes, battery saver, inactive/no-activate windows, Win10 fallback,
mixed DPI, and click-through. Microsoft documents inactive-window acrylic fallbacks, which
is especially relevant to Muna's no-activate notch.

Typography or icon replacement comes after the baseline fixes and requires the
[comparison protocol](#prototype-and-selection-protocol). Do not combine a font swap,
new palette, new primitive library, and new motion engine into one unmeasurable redesign.

## Verification and test results

### Environment

Windows execution host; Node `v24.19.0`; pnpm `10.34.5`; headless Chromium `153.0.8010.12`.
Node 24 satisfies the manifest but differs from the documented Node 22 LTS baseline;
this run is not an exact CI-environment reproduction.

The initial Vitest command failed because dependencies were absent. Restored them with
`pnpm install --frozen-lockfile`, then reran successfully. No dependency manifest or lockfile
was changed.

### Commands executed

Run these from the repository root:

```powershell
pnpm -w exec vitest run packages/ui/src/motion packages/ui/src/primitives/notch-surface.test.tsx packages/ui/src/primitives/panel-chrome.test.tsx packages/ui/src/primitives/module-bar.test.tsx packages/ui/src/primitives/strip-view.test.tsx packages/ui/src/tokens apps/desktop/src/shell
pnpm --filter @muna/ui typecheck
pnpm --filter @muna/desktop typecheck
pnpm --filter @muna/ui exec storybook dev -p 6017 --host 127.0.0.1 --no-open --ci --disable-telemetry
pnpm -w perf:smoke
pnpm -w docs:check
```

| Check | Observed result |
| --- | --- |
| Focused Vitest baseline | **PASS:** 19 files, 147 tests; includes shell state scenarios, geometry, presets, reduced motion, tokens, and primitives |
| UI and desktop typechecks | **PASS:** both exited 0 |
| Local Storybook | **PASS:** HTTP index responded and Chromium launched |
| Unrestricted axe on 10 rendered fixtures | **FAIL:** Text/Tones reports one serious color-contrast violation; other nine report no violations, but five panel-related fixtures leave contrast incomplete |
| Keyboard module switch | **PASS:** Tab then ArrowRight selects Calendar; focused tab has a 2 px blue outline |
| Reduced-motion module hover | **PASS:** computed scale is 1; transition is none |
| Loading motion preference | **PASS:** Skeleton/Default changes from shimmer to `animation-name: none` when reduced motion is emulated |
| Error recovery fixture | **PASS:** alert names connection recovery; Try again is keyboard reachable; axe reports no violations |
| Primitive morph | **PASS, limited:** reaches expanded width 458 px and collapsed width 212 px; morphing class clears and resting mask returns |
| Long content | **FAIL:** title/subtitle ellipsis lacks full-value reveal; Context chip visibly clipped |
| 320 px module bar | **FAIL:** document width 672 px; default and overflow fixture controls extend beyond the viewport |
| Header effective hit regions | **FAIL:** 4 px overlap between Pin and Collapse |
| White background material | **FAIL:** active white glyph over white-composited bar is 1.0000:1 |
| `perf:smoke` | **NOT MEASURED:** exit 0 prints "not measured yet"; source status is `not-implemented` with empty measurements |
| Documentation check | **PASS:** `docs:check` inspected 70 Markdown files, with zero lint/link problems; Prettier and `git diff --check` also passed |

The first nine axe fixtures were NotchSurface/Panel, PanelChrome/Default, LongContent,
Empty, RTL, ModuleBar/Default, Overflow, Text/Tones, and Skeleton/Default. The tenth was
EmptyState/Error. The research probe ran default axe rules without honoring the Tones
story's existing contrast exception; repository checks were not modified.

### Contrast measurements

Alpha-composite foreground over background in sRGB, convert channels to relative luminance,
then compare the lighter/darker luminances using WCAG's contrast calculation.
Threshold comparisons used unrounded values; these displayed values are rounded.

| Pair | Measured ratio | Required | Result |
| --- | --- | --- | --- |
| `--text-2` on `--panel-bottom` | 7.3325:1 | 4.5:1 | Pass |
| `--text-2` on `--panel-top` | 7.2818:1 | 4.5:1 | Pass |
| `--text-3` on `--panel-bottom` | 3.7134:1 | 4.5:1 | Fail |
| `--text-3` on `--panel-top` | 3.7929:1 | 4.5:1 | Fail |
| White active glyph on current bar over white | 1.0000:1 | 3:1 | Fail |

The white-background check changes only the Storybook page background for the experiment.
It is a deterministic material stress test, not a native desktop screenshot.

### Reproducing the browser checks

Open `http://127.0.0.1:6017/iframe.html?id=primitives-text--tones&viewMode=story`.
Run axe without the story's rule override. For ModuleBar/Default, tab into the bar and
press ArrowRight, then emulate reduced motion and inspect hover scale. For
ModuleBar/Overflow, resize to 320 px and compare button bounds with the viewport.

For the material experiment, temporarily set the preview document's `html` and `body`
backgrounds to white in DevTools, leaving component CSS unchanged. For PanelChrome/LongContent,
compare `scrollWidth` with `clientWidth`, inspect disclosure behavior, and read the Context chip.
For rail targets, include `::before` offsets rather than measuring only the visible buttons.

Raw scripts, JSON results, and screenshots are retained in this session's `files` artifacts:
`glass-ui-browser-check.cjs`, `glass-ui-browser-results.json`,
`glass-ui-detail-check.cjs`, and `glass-ui-detail-results.json`, plus named story PNGs.
They are local evidence, not an installed test suite or committed screenshot baseline.
An initial detail probe hit a generic Storybook heading before the story mounted;
using the component-specific readiness selector fixed the probe, and the complete run passed.

### Follow-up research verification

The expanded research did not install competing frameworks or assets and did not rerun the
unchanged 147-test baseline. The existing baseline results above are retained, not claimed
as new measurements of the proposed alternatives.

Additional evidence was produced by the session artifact `glass-color-matrix.cjs`, with
raw results in `glass-color-matrix.json`. From the repository root:

```powershell
node 'C:\Users\Shega\.copilot\session-state\66dc86e8-da8f-4602-8d23-a33a05af9f12\files\glass-color-matrix.cjs'
```

It completed successfully: 30 text-pair calculations, 16 accent-label calculations, and
three local font-file size measurements. Of the 30 text candidates, 13 meet 4.5:1 and 17 do
not. These are synthetic token-pair checks, not 30 rendered component tests.

Primary documentation and upstream license files were used to resolve unreliable search
summaries, including the Rive/Lottie/GSAP licensing differences. A few documentation pages
were unavailable, returned only headings, or had moved. Those were not treated as proof:
the old Spectrum color page is marked archive, and no Spectrum 2-specific conclusion is
claimed here. Recommendations reference the successfully read sources inline.

No new font rendering, native performance, or user-study result is implied. Documentation
lint, link, formatting, and whitespace checks are rerun for this extension.

### Not verified

Native WebView2 FPS, p95 frame time, CPU, RSS, 4K/150% behavior, actual 200% zoom,
Windows forced-colors rendering, full keyboard entry from the global hotkey, Narrator,
native focus restoration, and real desktop glass were not measured.

Do not infer those results from jsdom tests, headless morph completion, old spike numbers,
or the placeholder performance command. Release evidence still needs idle CPU at or below
0.3%, RSS at or below 120 MB, morphs at or above 58 fps, and the existing p95 frame budget
of 17 ms on the prescribed native setup. Do not lower these budgets to make glass pass.

## Implementation results

The eight baseline findings were implemented on 2026-09-28 after the research above, inside
the existing stack and tokens. The baseline sections are left as recorded; this section is
the after-state, measured with the same Storybook + Playwright + axe method.

### What changed

| Finding | Change | Where |
| --- | --- | --- |
| Module bar vanished on light backdrops | `--surface-2` is now painted over `--notch-black` inside the pill; the pill is capped at its container and the viewport | `packages/ui/src/primitives/module-bar.css` |
| Tertiary text 3.71:1 | `Text tone="tertiary"` and search placeholders render `--text-2`; `--text-3` keeps its value but is reserved for disabled glyphs; the Tones story's axe exemption is removed | `text.css`, `text.tsx`, `search-field.css`, `text.stories.tsx`, `docs/05-design-system.md` |
| 720 px panel floor overrides Rust's narrow bound | The floor is gone: strip, reveal, panel and module bar all fit `panelMaxWidth`, additionally capped by the notch window's measured client width | `apps/desktop/src/shell/shell-geometry.ts`, `notch-window.tsx` |
| Fixed 16-slot module bar overflowed at 320 px | Capacity follows the bar's measured width (`ResizeObserver`, disconnected on unmount); an active drag is dropped if the layout changes under it; every page has a focusable tab, not only the pager | `module-bar.tsx`, new `Narrow` story |
| Title/subtitle truncated with no reveal | Both wrap (`overflow-wrap: anywhere`, `text-wrap: balance`); the header grows past 44 px when needed | `panel-chrome.tsx`, `panel-chrome.css` |
| Chips clipped behind the heading | Chips sit between heading and rail and wrap with the rail to a second row; ⤡ collapse stays right-most on its row | `panel-chrome.css` |
| Rail hit areas overlapped by 4 px | Rail gap 4 → 8 px, so the 36 px effective targets are disjoint | `panel-chrome.css`, `docs/05-design-system.md` |
| Blur on the full-width module wrapper | The module body enters with `enterFromLarge` (opacity + scale, no blur); the panel column is capped at `panelMaxHeight` and the chrome body scrolls | `notch-window.tsx`, `panel-chrome.css` |
| Empty state told users nothing actionable | `PanelEmptyState` distinguishes a build with no modules (no action — nothing to enable) from all modules disabled (typed `commands.openSettings` with an inline `role="alert"` on failure) | `apps/desktop/src/shell/panel.tsx`, `packages/i18n/src/locales/en.json` |

### Measured after the change

Same host, same headless Chromium `153.0.8010.12`, unrestricted axe:

| Check | Before | After |
| --- | --- | --- |
| Text/Tones axe | 1 serious `color-contrast` (with the rule disabled in CI) | 0 violations, rule enabled; tertiary renders `rgba(255,255,255,0.6)` |
| Module bar over white | `rgba(255,255,255,0.07)` over transparent — 1.0:1 glyphs | `linear-gradient(surface-2)` over `rgb(0,0,0)` |
| Module bar at 320 px (Overflow story) | 640 px pill, 672 px document, 4 controls off screen | 288 px pill, 320 px document, 6 tabs + pager, 0 off screen; Tab → first tab, ArrowRight → next, Tab → pager |
| PanelChrome LongContent | title 560/272 px clipped, chip clipped, rail overlap 4 px | title unclipped across 3 lines, chip whole, rail overlap 0 px, collapse right-most |
| PanelChrome Default / WithChips | 44 px header | 44 px header (one row kept when the title is short) |
| PanelChrome RTL | — | collapse outermost, rail gap 0 px (disjoint) |
| `pnpm -w lint` | pass | pass (eslint, stylelint, prettier) |
| `pnpm -w typecheck` | pass | pass (contracts, ui, desktop, site) |
| `pnpm -w exec vitest run` | 147 focused | 318 tests / 54 files, all pass (incl. 6 new cases) |
| `pnpm -w storybook:ci` | not rerun at baseline | 156 stories, 0 axe violations, no exemptions |
| `pnpm -w i18n:check` | — | 188 keys, ok |

Two fixture lessons surfaced while verifying and are recorded in the stories rather than
hidden: a shrink-to-fit host resolves `max-inline-size: 100%` to the pill's own width (hence
the viewport term), and an `auto` grid track sizes to the pill's 640 px max-content and
centres the shrunk pill 176 px off screen (hence `grid-template-columns: minmax(0, 1fr)`).

### Still not verified

Unchanged from the research: native FPS/p95 frame time, idle CPU, RSS, real 200 % zoom in
WebView2, forced-colours rendering, Narrator, and native focus restoration were not measured.
The geometry and scrolling behaviour at zoom is proven in the browser at 320 px only.

## Plugin phase: what was built, and why it was withdrawn

With the UI foundation fixed, a media module was built on this branch through the existing
`ModuleBackend` + `ModuleDefinition` contract: an SMTC watcher in `muna-platform`, a pure
`Model` reducer with a timeline-drift filter, a typed `MediaStateChanged` event, and a
three-row `MediaCard` primitive. It passed every gate (14 Rust scenarios, clippy
`-D warnings`, 328 Vitest tests, 163 stories with 0 axe violations) and worked against a
live Edge/YouTube session in a native dev run.

It was then **withdrawn** and, on rebase, dropped entirely. Auditing the repository showed
that a parallel session's stack (`land-stack`, PR #58 and the ~40 PRs under it) was already
landing on `main`: by the time this branch was rebased, M2-E1/E2 media and M2-E3 HUD had
merged (`#22`, `#24`, `#25`, `#26`), with a fuller media module — settings pane, dashboard
widget, strip waveform — than the one built here. Two media modules on two branches would only
produce a merge conflict; the one built here duplicated work rather than adding to it. The
specs in `docs/modules/*.md` are what this branch started from; the stack is where they are
being implemented, module by module.

What **does** carry forward from this branch, because `main` still lacks it (checked at the
rebase point, `94c3784`):

| Fix on this branch | State on `main` |
| --- | --- |
| Readable tertiary text (`--text-2`), axe exemption removed | still `--text-3` at 3.7:1 |
| Shell honours Rust's narrow `panelMaxWidth` | still a 720 px floor |
| Panel title/subtitle wrap; chips whole; rail targets disjoint | still `truncate={1}` on both |
| Profile moved out of the NSIS install directory, with one-time migration | still `%LOCALAPPDATA%\Muna` |
| Module bar painted over `--notch-black` | **already fixed there** (same line; kept main's) |

The three reference-composition lessons the withdrawn module encoded — capability-aware
transport (leave controls out, do not disable them), artwork continuity across a late
thumbnail, and "republish on meaningful change, not on every tick" — are recorded above under
the reference review for whoever refines the landed media module.

### Live run, kept as evidence

The native dev run of this branch before the rebase (isolated profile, `scripts/dev.ps1
-HitTest`) is still the only real-device evidence gathered for the UI fixes and is kept here
for that reason:

| Observation | Result |
| --- | --- |
| Start-up | Notch attached; `muna.exe` 59 MB RSS (WebView2 not attributed) |
| Yield | Strip dropped to `peek` under a maximised window's caption (S5) and returned |
| Morph, idle desktop | expand 172 fps · max 6 ms · **0 dropped**; collapse 170–177 fps · 0 dropped (four Rust `morph` samples) |
| Morph, video playing underneath | expand **46 fps · max 36 ms · 2 dropped** (one dev-build sample) — the workload the perf harness (M2-E4) must characterise |
| Module bar over an orange wallpaper | black base clearly legible (the Phase 1 fix, on a real desktop) |
| Panel empty state | header, hairline and 28 px corner as specified |

The installed build also surfaced the profile/install-directory collision (the NSIS per-user
install lands in `%LOCALAPPDATA%\Muna`, on top of the data profile), which is the fourth fix
in the table above; it was reproduced from a console and verified fixed by launching the
reinstalled app from its Start Menu shortcut.

### Not verified

Idle CPU and RSS over five minutes, real 200 % zoom in WebView2, forced-colours rendering,
Narrator, native focus restoration, and the 46 fps case under a release build remain to be
measured on the prescribed setup. The rebased branch has been re-verified with the automated
gates only; it has not been run natively on top of the landed media/HUD modules yet.

## Verdict

**Baseline: Block** — the inspected baseline had HIGH findings in material contrast, text
contrast, narrow-width reachability, and long-content visibility.

**After implementation: Approve for the inspected surfaces** — every HIGH and MEDIUM finding
above is fixed and re-measured; no finding was waived by exemption. Native performance and
assistive-technology checks remain open and are listed as such. Passing unit tests and
typechecks still do not establish visual polish or native smoothness.
