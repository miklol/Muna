# QA checklist · Localization

Covers what [docs/localization.md](../../localization.md) promises and only a real Windows
can show: the language tiles against the display language and the regional format in Windows
Settings, the switch landing in both windows at once, the drafts on every surface, and the
right-to-left pseudo-locale walk that is spike S3 in
[m5-ship](../../build-plan/m5-ship.md#spikes-with-exit-criteria). The resolvers, the
document direction, the tiles and the catalogs are covered by the Vitest suites in
`packages/i18n` and `apps/desktop/src/lib`, and by `i18n:check`; the pseudo-locale stories
run under axe in `storybook:ci`. Rows 1–9 need Windows; rows 10–18 need the desktop
Storybook (`pnpm --filter @muna/desktop storybook`) and a pair of eyes.

## Running it

1. Note the machine's Windows display language (Settings → Time & language → Language &
   region → *Windows display language*) and regional format (*Regional format*). The rows
   assume English display and `en-US` format to start; adjust the expectations if not.
2. Start Muna (`scripts\dev.ps1`); open Settings → General → *Language*.
3. Keep the notch visible beside the settings window: several rows watch both.
4. Drive the setting (rows 1–9), then Storybook with the *Language* toolbar (rows 10–18).
5. Paste the table below with the build, the date, the display language and the regional
   format used.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Read the *Language* row on a fresh install | *Windows* is selected and reads *Follows the Windows display language, currently English*; the other tiles read *Deutsch*, *Français*, *Español*, *Português (Brasil)*, each with *Machine draft, not yet reviewed by a native speaker*; *English* reads *Written by the Muna team*; no *Pseudo RTL* tile |
| 2 | Pick *Deutsch* | the pane, the sidebar and the notch's strip switch to German without a restart or a flicker; the tile is checked; `settings.json` → `general.language` is `"de"` |
| 3 | With *Deutsch* chosen, open a panel with a date and a number (Calendar, System monitor) | weekday and month names read German, decimals use a comma, times are 24-hour — even though the Windows regional format is `en-US` |
| 4 | Pick *Windows* again; in Windows Settings set *Regional format* to *Deutsch (Schweiz)*, then restart Muna | text is English again; a decimal reads `1.5` and a thousands group uses the apostrophe (`1’234`), dates read day-first with dots (`28.09.2026`) — the regional format, not the display language |
| 5 | Set the Windows display language to *Français*, sign out and in, start Muna with *Windows* chosen | the UI is French; the Windows tile reads *Suit la langue d'affichage de Windows, actuellement Français* |
| 6 | Set the Windows display language to one Muna has no catalog for (Nederlands), sign out and in | the UI is English; the Windows tile names *English*; dates and numbers still follow the regional format |
| 7 | Set the Windows display language to *Português (Portugal)* | the UI is the Brazilian catalog (`pt-PT` → `pt-BR`); the tile names *Português (Brasil)* |
| 8 | With *Français* chosen, walk every settings pane and the onboarding tour (Settings → General → *Welcome tour* → *Show again*) | no English sentence anywhere except product names and unit symbols; no clipped label, no button whose text wraps onto a third line, no exclamation mark; the palette (Ctrl+Shift+Space) lists actions in French |
| 9 | Edit `settings.json` → `general.language` to `"xx"` while Muna is closed, start it | Muna behaves as *Windows*; the tile is *Windows*; no error is logged beyond the settings load line |
| 10 | Storybook → any story → the *Language* toolbar | lists *English*, *Deutsch*, *Français*, *Español*, *Português (Brasil)*, *Pseudo RTL* |
| 11 | *Pseudo RTL* on `Shell/Command palette › PseudoRtl` | the text reads mirrored and the layout is right-to-left: what led each row now trails it (glyphs at the right, shortcut hints at the left); the list's leading edge is the right edge; nothing is clipped |
| 12 | *Pseudo RTL* on `Settings/General pane › PseudoRtl` | the sidebar moves to the right; row titles align right; each row's control (toggle, button, tiles) sits at the left; the check mark on the chosen tile sits at the tile's trailing edge |
| 13 | *Pseudo RTL* on `Modules/Notes/Panel › PseudoRtl` | the list, the editor and the header mirror; the back arrow points right; the search field's clear button and the *More* menu sit at the left |
| 14 | *Pseudo RTL* on `Modules/Translation/Panel › PseudoRtl` | the language pair mirrors (the arrow between the languages points left); the primary button keeps the trailing edge; the answer box's scrollbar sits at the left |
| 15 | *Pseudo RTL*, watch punctuation and numbers on rows 11–14 | a sentence's full stop sits at the visual start (left) of the mirrored line — an LTR leak is a full stop stranded at the right; numbers stay Western and unmirrored |
| 16 | *Pseudo RTL* → *Deutsch* → *English* on the same story | `<html dir>` flips to `ltr` for the German catalog and stays; `lang` reads `de` then `en`; the story re-renders without a stale mirrored string |
| 17 | The a11y addon on each of rows 11–14 | zero violations, same as in `storybook:ci` |
| 18 | Any story with `Direction: RTL` in the toolbar but *English* in *Language* | the layout flips but the text does not mirror — the two toolbars are independent; both can be on together |

Findings from rows 11–15 are layout defects, not translation defects: file them as M5-E3
rows (logical properties, mirrored glyphs) and note them in the table below.

## Results

| Build | Date | Display language | Regional format | Rows passed | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | Not yet run: the E6 branch was built in an agent session without a Windows Settings pass; rows 10–18 were walked in Storybook (see the PR). |
