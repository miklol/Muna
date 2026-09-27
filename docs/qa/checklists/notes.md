# QA checklist · Notes

Covers the acceptance criteria of docs/modules/notes.md: notes survive restarts as plain `.md`
files other apps can read, and quick capture lands in the editor from any app. The scan, the
excerpts, the title-to-file-name rules, pins, conflicts, the Recycle Bin path and every refusal
are covered by `tests/notes.rs` against the fake platform; this checklist is the folder,
other-app and visual side, and it needs a second editor (Notepad, VS Code or Obsidian) and,
for rows 22–24, a removable drive.

## Running it

1. Start Muna (`scripts\dev.ps1`). Settings → Notes shows *Default folder ·
   `%APPDATA%\Muna\notes`*; the folder may not exist yet.
2. Have the second editor open on the same folder.
3. Drive the list (rows 1–8), the editor (rows 9–17), other apps (rows 18–21), the folder
   (rows 22–27), the quick note and widget (rows 28–31).
4. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Open the Notes panel with no folder on disk | *No notes yet* with *Create one above, or use the quick note shortcut to jot something into Inbox.*; the search field and *New note* show; the folder is **not** created yet |
| 2 | *New note*, type `Meeting`, Enter | the folder appears with `Meeting.md` (empty, 0 bytes); the editor opens on *Meeting* with the caret in the text field; the status line reads *Edited hh:mm* |
| 3 | *New note*, type nothing, Enter; then type `Meeting` again, Enter | nothing happens on the blank title (the field stays open); the second one creates `Meeting 2.md` and the editor opens on *Meeting 2* |
| 4 | *New note*, type `a/b: c?`, Enter | `a b c.md` — the forbidden characters are gone; the title in the header is `a b c` |
| 5 | *New note*, then Escape (or the *Cancel* button) | the title field is replaced by the search field again; nothing was created |
| 6 | Type `meet` into *Search* | after a short pause only *Meeting* and *Meeting 2* remain and the count reads *2 notes*; a word that matches only a note's body also lists it; *No notes match* with *Try another word, or clear the search.* for `zzz` |
| 7 | Clear the search with the × button | every note is back, pinned ones first, then newest first; the count reads *N notes* |
| 8 | A folder with sub-folders (`work/Retro.md`) | the row shows *in work* where the excerpt would be when the note is empty; the note opens and saves in place |
| 9 | Type in the editor, wait a second | *Saving* then *Saved* in the status line; the file on disk has the text, LF line endings, no front matter |
| 10 | Type, then press *Back to the list* within half a second | the list shows the new excerpt at once; the file has the text (the pending save ran on close) |
| 11 | Type, then click on the desktop so the notch collapses | the file has the text (save on blur); the panel opens again on the list |
| 12 | *Rename* in the header, type `Standup`, Enter | the header reads *Standup*; `Meeting.md` is now `Standup.md`; the caret returns to the text; the body is unchanged |
| 13 | *Rename*, type `Standup 2`, Escape | the title is unchanged; the field closes |
| 14 | *Pin* on the editor header | the button shows pressed; back in the list the note is first with the pin glyph and *Pinned* to assistive technology; a restart keeps it; *Unpin* undoes it |
| 15 | *Preview* on a note with `# Title`, `- [ ] task`, `**bold**`, a fenced block and `[Muna](https://example.com)` | headings, the task glyph (not a checkbox), bold, the code block and the link text render; the link does nothing on click and shows the address on hover; *Edit* returns to the text with the same content |
| 16 | *Show in Explorer* | Explorer opens the folder with the file selected |
| 17 | *Move to Recycle Bin* | the editor closes, the row is gone, the file is in the Recycle Bin (Explorer → Recycle Bin → Restore brings it back on the next open of the panel) |
| 18 | Edit the open note in the second editor and save, then type one character in Muna | the status line reads *This note changed in another app and was reloaded.*; the text shows the other editor's version; the next keystroke saves normally |
| 19 | Create `Shopping.md` in the second editor, reopen the panel | the row is there with its first line as the excerpt (marks such as `#`, `-` and `**` stripped) |
| 20 | Rename the pinned note in Explorer | on the next open the note lists unpinned under its new name (the pin followed the old id and was pruned); the old name is gone |
| 21 | Delete a note in Explorer while it is open in Muna, then type | *The note could not be saved. Check the folder and try again.*; the next time the panel opens the row is gone |
| 22 | Settings → Notes → *Change*, pick a folder on a removable drive | the pane shows the chosen path with *Use the default folder* under it; the panel lists that folder's notes; `settings.json` has `"notes": { "folder": "E:\\…" }` |
| 23 | Unplug the drive, open the panel | *The notes folder is missing* with *E:\… cannot be found. Plug the drive back in, or choose another folder in Settings.* and *Open settings*; the pane shows *This folder cannot be found right now.*; the widget reads *The notes folder is not available*; the folder is **not** recreated on the system drive |
| 24 | Plug the drive back in, open the panel | the notes and their pins are back |
| 25 | *Use the default folder* | the pane shows *Default folder · `%APPDATA%\Muna\notes`*; the panel lists the default folder's notes again |
| 26 | *Open folder* | Explorer opens the folder in use |
| 27 | A 3 MB `.md` file in the folder | its row lists; opening it shows *Too large to edit here* with *Notes over 2 MB open in your default app instead.* and *Open in another app*, which opens the default `.md` app |
| 28 | Keyboard shortcuts → *Write a quick note*, set a chord, press it from another app | the notch opens on Notes with *Inbox* in the editor and the caret after the last character, within 200 ms of the chord; `Inbox.md` exists at the root of the folder |
| 29 | Press the chord again with Inbox already open and text typed | the text is unchanged (nothing reloads over it); nothing was created twice |
| 30 | Dashboard → *Add a widget* → Notes | the card shows the pinned note's title and first line (or the newest note when nothing is pinned); a wide card adds *Edited hh:mm*; with an empty folder it reads *Pin a note to keep it here* |
| 31 | Reduced motion (Windows *Animation effects* off) | the list ↔ editor swap is a fade with no travel; status changes still show |
| 32 | 200 notes in the folder, open the panel | the list opens without a visible pause; the list scrolls inside the panel at 60 fps; `ci:app` idle numbers are unchanged with the panel closed |
| 33 | Windows 10 22H2 | rows 2, 9, 16, 17, 23 and 28 |

## Results

Recorded per run; the first pass is in the M4-E7 PR description.
