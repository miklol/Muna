# QA checklist · Accessibility

Covers what [05-design-system.md → Accessibility](../../05-design-system.md#accessibility)
promises and only a real Windows with Narrator, a contrast theme and a touch screen can show.
The names, roles, heading levels, contrast and focus order of every panel and pane are checked
by axe in `storybook:ci` (every surface has a story, each with a `PseudoRtl` variant); the
strip's live region, the two Appearance switches and the settings migration are covered by
Vitest and `cargo test`. Rows 1–12 need Windows 11 with Narrator; rows 13–16 need a Windows
contrast theme; rows 17–19 need a touch screen or a pen; rows 20–22 need the desktop Storybook
(`pnpm --filter @muna/desktop storybook`) and a pair of eyes.

## Running it

1. Start Muna (`scripts\dev.ps1`) with the defaults: *Increase contrast* and *Announce
   notices* off (Settings → Appearance → Accessibility), Windows contrast themes off, *Reduce
   motion* following Windows.
2. Start Narrator (`Ctrl+Win+Enter`). Scan mode is on by default; the rows say when to leave
   it (`Caps Lock+Space`).
3. Keep Settings open beside the notch: several rows switch a setting and watch the notch.
4. Drive rows 1–12 with the keyboard only; do not touch the mouse until row 17.
5. Paste the table below with the build, the date, the Windows build and the Narrator and
   contrast-theme states used.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | `Ctrl+Alt+Space` with the notch collapsed | the panel expands and Narrator reads the module title as a dialog ("Media, dialog"); focus is on the first control inside, not on the module bar, and nothing in the desktop behind loses its state |
| 2 | `Tab` through the open panel to the end, then `Shift+Tab` back | every stop is spoken with a role and a name (no "button" without a name, no "group"); the visible focus ring is the 2 px accent ring, never a browser default; the order follows the layout, header before body before footer; the last `Tab` does not leave the panel for the desktop and does not wrap silently — focus stays on the last control |
| 3 | `Ctrl+Tab` and `Ctrl+Shift+Tab` in the open panel | the module changes, Narrator reads the new dialog title, and focus lands inside the new panel |
| 4 | `Esc` in the open panel; then `Esc` inside a text field with text in it | the first `Esc` in a field clears or leaves the field, the next collapses the panel; the collapse is spoken as the dialog closing; focus goes back to the window that had it before the panel opened |
| 5 | Play a track in Spotify and skip it twice with *Announce notices* off | Narrator says nothing; the track is still there for scan mode — `Ctrl+Alt+Space`, then `Caps Lock+Up` to the panel header reads it as plain text |
| 6 | Turn on Settings → Appearance → *Announce notices*, then skip a track and connect a Bluetooth device | each change is read once, after the current Narrator sentence finishes (polite), without moving focus; three quick presses of the *Volume up* key end with the final level read, not three separate sentences — if all three are read, file it as an `a11y` throttle defect against the strip description, not the HUD |
| 7 | Turn the switch off again while a notice is showing | the next change is not read; the setting persists across a restart (`settings.json` → `general.announceNotices`) |
| 8 | Open Settings and `Tab` from the search field through the sidebar into a pane | the sidebar is a vertical tab list (Narrator reads "tab, 3 of 12"); `Down`/`Up` change the pane, `Tab` moves into it; the pane's title is read as heading level 1 and each section title as heading level 2 (`Caps Lock+H` walks them in order without a skipped level) |
| 9 | `Caps Lock+H` through the Media, Calendar, To-do and Pomodoro panels | the only level 1 is the panel title; the module's own headings (track title, agenda day, list name, phase) are level 2; no level 3 without a level 2 above it |
| 10 | Weather panel, scan the hourly strip | each hour reads its time, temperature and, where shown, a full sentence ("60% chance of rain"), not a bare percentage; hours under 10 % read no chance at all |
| 11 | Calendar panel on a day with more events than fit, `Tab` to the agenda | the agenda list is a stop named "Events on" followed by the day, the focus ring shows on it, `Down` scrolls the list, and the events inside read as list items |
| 12 | Every icon-only button in the open panel and in Settings (`Caps Lock+B` steps through buttons) | each has a spoken name that says what it does ("Skip forward", "Unmute Calendar", "Delete the Errands list"), not the glyph name; the names change with the state ("Mute" ↔ "Unmute") |
| 13 | Windows Settings → Accessibility → Contrast themes → *Night sky*, apply | both windows step up without a restart: hairlines and secondary text are brighter, the strip has a 1 px outline against the dark wallpaper, album tints are gone; `document.documentElement` has no `data-contrast` (the theme, not the switch, did it) |
| 14 | Still on *Night sky*, open the About pane and hover *Reset all settings* | the red label is legible on the hovered row (axe reads ≥ 4.5:1; by eye it is a lighter red than in the normal theme) |
| 15 | Contrast theme off, Settings → Appearance → *Increase contrast* on | the same step as row 13 on both windows, `<html data-contrast="more">`; off returns the normal values; a restart keeps the choice |
| 16 | *Increase contrast* on **and** the *Desert* contrast theme (light) | the settings window follows Windows into the light appearance and uses the light contrast values (darker secondary text, darker red); nothing is white on white; the notch stays dark |
| 17 | On a touch screen, tap every toggle, checkbox, chip and segmented control in the Appearance, Layout and a module pane | each tap lands on the first try with a finger, not a nail; two chips in adjacent rows never trigger each other; the visible size is unchanged |
| 18 | Tap a list row, a card and a tab, then lift the finger | nothing stays tinted as if hovered; the pressed state ends when the finger lifts; the slider knob in the HUD does not stay visible after a tap |
| 19 | Pen (or touch) drag on the volume strip in the HUD | the value follows the drag; Narrator with *Announce notices* on reads the final value once |
| 20 | Storybook → any story → *Contrast: more* in the toolbar, then *Language: Pseudo RTL* | the story steps up the same way as row 15 and mirrors; the a11y addon shows zero violations on both |
| 21 | Storybook → `Primitives/Text › Tones` with the a11y addon open | zero violations, including `color-contrast` on the tertiary line (the opt-out is gone) |
| 22 | Storybook → *Reduce motion: on* → `Modules/Drop actions/Drop surface › PseudoRtl` and `Shell/Command palette › Default` | tiles and rows appear without a stagger or a slide, only a fade; nothing is left invisible; the a11y addon shows zero violations |

Rows 1–4 and 8–12 are keyboard and Narrator; a failure there is a code defect, not a content
defect. Rows 13–16 that fail only under a Windows contrast theme and pass under the switch are
a `prefers-contrast` mapping problem in WebView2 — record the WebView2 version.

## Results

| Build | Date | Windows build | Narrator | Contrast theme | Rows passed | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | Not yet run: the E3 branch was built in an agent session without Narrator or a touch screen; rows 20–22 were walked in Storybook (see the PR). |
