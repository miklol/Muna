# Reference · UI observations from MacNotch screenshots

> My own analysis of 65 MacNotch screenshots (3456×2234 MacBook Pro captures, cropped to the
> top-centre notch region). Numbers are estimates in **CSS px at 1×**, derived from the 2×
> captures. Use these as the starting anatomy for Muna; the design-system doc formalises tokens.

## 1. Collapsed strip

```text
┌──────────────────────────────────────────────┐   ← flush with the top screen edge
│ [◼ app icon 20px]                 ▮▮▮▯▮ / 27:33 │   height ≈ 32 px (macOS menu bar height)
└──────────────────────────────────────────────┘   width ≈ 200–300 px, bottom radii ≈ 14 px
```

- Pure black `#000` fill (blends with the physical notch). No border, no shadow when collapsed.
- **Two slots:** leading (rounded-square app icon or album art, 20–22 px, radius 5 px) and
  trailing (status: audio bars visualiser, timer digits in module accent colour, battery %).
- Hover-reveal wide form (≈ 560 px): leading icon + title (13 px, white 90 %) + transport
  (⏮ ⏸ ⏭ 16 px glyphs) or (↺ ⏸ ⏭ ✕) for Pomodoro. Timer digits use tabular numerals.
- Accent colours seen: media title in **cyan/blue** `#5AC8FA`-ish; Pomodoro digits in
  **orange-brown** `#D9A066`-ish; event dots in **system blue**.

## 2. Expanded panel

```text
╭────────────────────────────────────────────────────────────────────╮  ← flush with top edge,
│ Title 17px semibold   [chip ▾]              (◯)(◯)(◯)(◯)(◯)  ▎ ♪   │    top corners square
│                                                                  ▎ ⌁   │
│  content area (≈ 960 × 260)                                      ▎ </>│  right icon rail
│                                                                  ▎ ▭   │  (quick module jump)
│                                                          (⤡)     ▎ 🔔  │  collapse button
╰────────────────────────────────────────────────────────────────────╯  bottom radii ≈ 28 px
                         ( ▦ ☁ ▦ ▤ ◔ ▤ ⌛ ♪ ⚡ </> ▭ 🔔  ⌘ ◎ )        ← module bar pill
```

- Panel width ≈ 900–1000 px; height ≈ 260–330 px depending on module ("expanded height"
  option for some modules). Corner radius bottom ≈ 28 px; the panel edge is a **hairline
  white ≈ 10 % alpha** border.
- **Material:** near-black glass — top region ≈ `#000` fading to `rgba(20,20,22,0.85)` at the
  bottom with the wallpaper faintly visible; i.e. a vertical gradient over a backdrop blur.
- **Header row (≈ 44 px):** module title 17 px/600 (+ optional subtitle 12 px/400 at 60 %
  alpha, e.g. "Sitting for 4m", "0 sessions today", "8 items today"); context chips (pill,
  `rgba(255,255,255,0.10)` bg, 12 px/600, e.g. `Work ›`, `Today`, `Agents ›`, `Apps ›`,
  `All ›`, `Mainz`, `29m`); right-aligned **circular icon buttons** 28 px, bg white 10 %,
  icon 14 px (refresh, screenshot, info, settings, collapse-to-strip ↓).
- **Right icon rail:** vertical stack of 14 px module glyphs at 55 % alpha, active at 100 %.
  Acts as quick module switcher when the panel is open.
- **Collapse button (⤡):** 30 px circle, bottom-right inside the panel, bg white 12 %.
- **Module bar:** floating pill ≈ 640 × 40 px, bg `rgba(0,0,0,0.8)` + hairline, glyphs 16 px
  at 70 % alpha, active glyph inside a 28 px white-12 % circle. Sits ≈ 12 px below the panel.

## 3. Module layouts observed

| Module | Layout |
| -------- | -------- |
| **Media** | Left: 72 px album art (radius 10) + title 17/700 + artist·album 11/400; progress bar 3 px + times 10 px; transport row: shuffle, ⏮, ⏸ (36 px white circle, black glyph), ⏭, repeat, output-device. Right: **Lyrics** column (label 10/600 caps at 50 %, current line 17/600 white, next lines 13 at 50 %). Header chip = source app (`YT Music` with icon). |
| **Dashboard** | 2×4 grid of widgets in a 4-slot layout: Events list (icon, title 14/600, time 12 at 60 %), Launcher (row of 6 app icons, "Set 1 of 2" pager dots), Pomodoro card (25:00 ring/paused, ↺ ▶ ⏭), Day Progress ("Starts in 3h 24m" + quote), second row: Reminders/Tasks with radio circles, PR review queue, "No reminders — All caught up for today!" empty state, **Quick toggles** (6 × 32 px circular toggles). Header chip: profile `Work ›` + ⚡ (Focus). |
| **Calendar** | Left: vertical month-jumper (JUL 07 / **AUG 08** / SEP 09) + month grid (7 cols, 13 px, today = white filled circle w/ black digit, event dots). Right: agenda list (time range column in blue 12/600, title 15/600, location 12 at 60 % with ↑ icon, unread dot). Header: title + month, `Today` chip, icon buttons (grid/list/screenshot/refresh/‹ ›/search). |
| **Pomodoro** | Left: mode card (Work / Ready to focus) + 100 px ring dial (25m) with ↺ and ⏭ side buttons + "No focus target" row. Middle: preset list (Work 25m, Short Break 5m, Long Break 15m, Quick Timer 5m, Custom 5m) with drag handles. Right: **Focus Target** list (task/event rows with `Select` pill buttons). |
| **Day Progress** | Left stats column (Today, Completion 0/8 + bar, counts per source, Bedtime). Right: vertical timeline with time labels, pill-shaped node icons, dotted connectors, "Long stretch—3h 5m of potential!" hint + `+ Add Task` red pill. |
| **Screen Time** | Left insights column (Avg / Longest, Categories with coloured dots + durations, `Settings ›` row). Right: "Now" card (app icon + name + duration), donut (1h 50m today) + stacked category bar + legend, "App ranking" rows with bars. |
| **Health** | Left: Today stats (Active, Longest sit, Breaks, Mindful). Middle: 3 concentric rings (green/blue/purple) + weekday dots + goal counters (Breaks 4/6, Water 7/8 droplets ± buttons, Mindful 0/2). Right: "Take a break" action cards (Move 3 min, Breathe 4-4-4-4, Stretch 2 min, Eye rest 20s) each with a coloured icon + ▶. Header chip `29m`, layout toggle, collapse. |
| **Weather** | Compact: big icon + 17°C 34/700 + condition, H/L; chips (temp/humidity/wind); hourly 12-col strip (hour, icon, temp). Background: photographic night sky. |
| **Code hosting** | Left nav (PRs / MRs 6 to review, Pipelines, Jira) with counts. Right: rows with avatar, title 15/600, `repo #num` + provider chip, stats (`+64 −51 · 6 files · Pipeline running`) in green/red, provider logo, ↗ open button. Header chip `All ›`. |
| **AI Coding** | Session rows: terminal-style icon w/ status dot, project name 14/600 + `Running`/`Waiting` chip (green/blue) + model chip (`Opus` orange / `Sonnet` blue / `Gpt`) + `CLI` chip + branch; task line; monospace "Editing File.swift"; right: elapsed + `28 msgs · 50.4k tok`. "Recent" section. Header: `3 active` green dot, `Agents ›` chip. |
| **Notifications** | Cards (white 6 % bg, radius 14): app icon 36 px, app name 12 at 60 %, title 15/600, body 13 at 70 % (2 lines), time right, hover actions (reply / open / ✕) in 24 px circles. Count badge in header (`9`), `Apps ›` chip, `…` menu. |
| **Live Activities** | Grid of activity cards (icon/art 40 px, name 13/600, primary line in accent, secondary at 60 %) each with `Focus`/`Unfocus` pill; inactive cards at 40 % alpha. |
| **Drop Actions** (drag-over state) | Panel becomes a row of equal tiles separated by hairlines: outline icon 40 px, title 17/600, subtitle 12 at 60 %; disabled tiles at 40 %; header "Preview mode" eye icon. |
| **Shelf** | Dashed-outline drop zone (radius 16) filling the panel: empty state icon + "Drop files here" 17/600 + hint 13 at 60 %. With items: grid of 64 px thumbnails + filename 11 px; header shows `4 items`, select-all/clear circles, `Copy ⇄` chip, trash, collapse, info. |
| **Bluetooth** | Dashed-outline area with device columns: name 15/700, `Disconnected` chip, device glyph 40 px (headphones/phone/mouse), battery pill (green icon + 95 %), ✕ disconnect button. |
| **System Analytics** | 3×2 grid: label w/ icon (CPU, Memory, Storage, Network, Battery, Free Disk), 36 px ring gauge with % inside (green/blue/cyan), big value 17/600 monospace-ish, secondary 12 at 60 % ("29,28 GB / 48 GB"). |
| **Translation** | Two text cards (white 6 % bg, radius 16) with language pills (`ENGLISH ▾`, `GERMAN ▾` 12/700 uppercase) and a central 44 px white → button + swap ⇄ button; mic icon bottom-left; copy icon. |
| **Window snap** (drag state) | Full-width strip of layout glyph tiles (outlined rectangles with filled zone) separated by hairlines; header "Preview mode". |
| **Settings window** | Standard macOS window, dark: sidebar 260 px (app icon + name, search field, nav rows w/ icons: Layout, Multiple Screens, Drop Actions, …); content cards (radius 16, bg white 4 %, header row icon + title + count chip + chevron); grid of option tiles with check circles; title-bar pill "MacNotch Settings · Dark · ?" |

## 4. Interaction cues seen

- Hover on the strip → wide form; hover longer / click → expand. Collapse via ⤡ button or
  moving the cursor away (auto-collapse).
- Header "↓" circle = collapse to strip; "ⓘ" = module help; "↻" = refresh.
- Right rail glyphs and module bar both switch modules; active state = filled circle.
- Drag files over the strip → panel morphs into Drop Actions tiles; drag windows to the top →
  Snap zones tiles.
- Preview mode banners (yellow text, right-aligned) when a Settings pane is editing that overlay.

## 5. Typography & colour reads

- Face: SF Pro (Apple). Sizes: 10 (caps labels), 11, 12, 13, 15, 17, 34 (weather temp).
  Weights 400/600/700. Tabular numerals for times/counters.
- Text alphas: 100 % primary, 60 % secondary, 40–50 % tertiary/disabled.
- Surfaces: white 4 % (cards on panel), 6–8 % (elevated cards), 10–12 % (chips, icon buttons),
  16 % (hover). Hairline white 10 %.
- Accents (iOS-like): blue `#0A84FF`, cyan `#64D2FF`, green `#30D158`, orange `#FF9F0A`,
  red `#FF453A`, purple `#BF5AF2`, mint/teal for Health rings, warm tan for Pomodoro.
