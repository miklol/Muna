# Notes

**Tier P2 · Owner: `muna-module-developer` · Status: implemented (M4-E7) — see
[Implementation notes](#implementation-notes-m4-e7)**

## Reference

`demo-12`, `demo-19`, `notes-feature-2`. Scratchpad list + editor; create/open from Dashboard.

## Behaviour

Local markdown files in `%APPDATA%\Muna\notes\` (user-changeable folder, works with Obsidian
vaults); list sorted by modified; quick capture hotkey appends to "Inbox"; pin notes; search;
plain textarea with light markdown preview toggle (no rich editor in v1).

## Acceptance criteria

- Notes survive restarts and are plain `.md` readable by other apps.
- Quick capture from any app in ≤ 200 ms (panel opens pinned with the cursor in the editor).

## Implementation notes (M4-E7)

The folder is the database. Every note is one `.md` file, the title is the file name, and the
module never keeps a second copy of anything the file already says — Obsidian, VS Code or
Explorer can rename, edit and delete notes while Muna runs and the list simply catches up.
Pieces, in the order a keystroke flows:

- **Files** (`src-tauri/src/modules/notes/files.rs`): walks the folder to a depth of four,
  skipping dot-folders (`.obsidian`, `.git`, `.trash`), symlinks and anything that is not
  `*.md`, at most 2 000 notes; the **id** is the path relative to the folder with `/`
  separators (`work/Meeting.md`), the **title** the stem. Reading normalises CRLF to LF;
  writing puts the body down as UTF-8 unchanged otherwise — no front matter, no heading
  rewrite. The list carries an **excerpt** (the first lines with words in them, heading, list
  and quote marks and emphasis stripped, at most 160 characters) read from the first 4 KiB of
  each file, never whole bodies. Titles become file names through `stem_for` — forbidden
  characters and trailing dots stripped, reserved device names (`CON`, `NUL`, …) and blanks
  become `Untitled`, at most 80 characters — and `unique_path` appends a space and `2`, `3`, …
  so a create or rename never overwrites. Notes over **2 MiB** are listed but refused by the
  editor (`notes.tooLarge`) and open in the default app instead.
- **Service** (`mod.rs`, Tauri-free `NotesService`): `refresh` rescans and answers the
  snapshot — **pinned first**, then newest, newest first within each group; `create`, `open`,
  `open_inbox` (`Inbox.md` at the root, created empty on first use), `save`, `rename`,
  `search`, `reveal`, `open_external`, `reveal_folder`, `choose_folder`. **Pins** are the one
  thing the file cannot hold, so they live in `Store` meta (`notes:pins`, a JSON array of ids
  in pin order); a rename moves the pin, a delete drops it, and a pin whose file is gone is
  pruned at the next scan — unless the whole folder is away, in which case pins wait for it.
  **Saves carry the baseline**: the editor sends the `modifiedMs` it loaded with and the
  service refuses (`notes.conflict`) when the file has changed since, so an edit made in
  another app is never overwritten; the editor reloads and says so. **Delete** goes through
  `FileOps::recycle` — the Recycle Bin, never a permanent delete. **Search** is a full read
  of every note on request (title and body, case-insensitive, newest first, at most 100
  hits), which is fine for the hundreds of notes a scratchpad folder holds; an index is not
  worth its cache. No file watcher in v1: every snapshot is a rescan the UI asks for when the
  panel or a widget opens and after every write, so an idle app costs nothing.
- **Folder** (`settings.rs`): `settings.modules.notes = { folder: null }` means the default,
  `%APPDATA%\Muna\notes` (created on demand, next to the profile); a chosen folder is used as
  is and **never created** — when it is missing (an unplugged drive) the snapshot carries
  `problem: 'missing'` and every write is refused with `notes.io` (*not found*); a folder that
  exists but cannot be walked is `problem: 'unreadable'`. `notes.noFolder` is reserved for a
  build with no folder at all. The pane changes the folder through the settings document; Rust
  follows the change and announces a fresh snapshot.
- **Contract**: `get_notes_snapshot`, `notes_command({ kind: 'refresh' | 'pin' | 'delete' })`,
  `notes_create(title)`, `notes_open(id)`, `notes_open_inbox()`,
  `notes_save({ id, body, baseModifiedMs })`, `notes_rename(id, title) -> Note`,
  `notes_search(query) -> string[]`, `notes_reveal(id)`, `notes_open_external(id)`,
  `notes_reveal_folder()`, `notes_pick_folder(title) -> string | null`, and the
  `NotesChanged { snapshot }` event. Error codes
  `notes.noFolder | unknown | conflict | tooLarge | emptyTitle | io`. The snapshot is
  `{ folder, defaultFolder, notes[], inboxId, problem }`; a `Note` is
  `{ id, title, folder, excerpt, modifiedMs, bytes, pinned }`, a `NoteContent` adds the
  `body`. Zod schemas, the settings helpers and `widgetNote` live in `@muna/contracts`; the
  constants `NOTES_INBOX_ID`, `NOTES_MAX_NOTE_BYTES` and `NOTES_AUTOSAVE_MS` (600) are shared
  by both sides.
- **Panel** (`src/modules/notes/panel.tsx`): a **list** — a search field (the folder is
  searched 150 ms after the last keystroke) and *New note*, which swaps the field for a title
  field (Enter creates and opens, Escape cancels); rows show the title, the excerpt (or the
  sub-folder), when the note changed (the time today, `Sep 20` this year, the year before
  that) and a pin glyph; a count under the rows — and, in place of the list, the **editor**:
  *Back*, the title with *Rename* (a field in the header; Enter commits, Escape or blur
  cancels), *Pin* (`aria-pressed`), *Preview / Edit*, *Show in Explorer* and *Move to Recycle
  Bin* as icon buttons (the design system has no menu primitive yet), the `TextArea` and a
  `role="status"` line: *Edited 9:30 AM*, *Saving*, *Saved*, the conflict sentence or the
  failure sentence. Text **autosaves** 600 ms after the last change, on blur and when the
  editor closes (back, another note, the panel) — a delete cancels the pending write. The
  **quick note** action (`notes.quickNote`, bound under Keyboard shortcuts) sets a flag in the
  module store and opens the panel; the panel opens *Inbox* with the caret after the last
  character — "appends to Inbox" in the spec is the cursor at the end, not a Rust-side
  append, so the user sees what is already there. A folder problem replaces the list with an
  empty state that names the folder and opens Settings.
- **Height budget**: the rows scroll inside 219 px and the editor's text area is 219 px tall
  (the preview at most that), so the list and the editor both land on the shell's 360 px
  maximum with the count and the status line in view.
- **Markdown-lite preview** (`markdown-lite.tsx`): a line-oriented reading of headings,
  paragraphs, bullet, numbered and task lists (a glyph, never a control — the file is the
  truth), quotes, fenced code, rules, with inline code, bold, italic and links. Output is
  React elements, never raw HTML, so a note can say anything. **Links are shown, not
  followed**: there is no general open-URL command and the notch should not open addresses
  read from a file; the address is the span's `title`.
- **Widget** (`widget.tsx`): the first pinned note's title and first line, or the newest note
  when nothing is pinned; a wide card adds *Edited …*; one line for an empty folder (*Pin a
  note to keep it here*) and for a folder that is away.
- **Settings pane** (`settings.tsx`): the folder in use (*Default folder · path* or the chosen
  path) with *Change* (the folder picker, through Rust) and *Open folder*; under a chosen
  folder, *Use the default folder* and, when the drive is unplugged, *This folder cannot be
  found right now.*; then what the quick note does and where its shortcut lives.
- **Against the plan**: `docs/build-plan/m4-power-tools.md` said "markdown-lite notes in
  SQLite"; this document's plain-files-in-a-folder wins because the acceptance criterion is
  "plain `.md` readable by other apps" — SQLite holds only the pins. No file watcher, no rich
  editor, no clickable links, no drag-to-reorder in v1.
