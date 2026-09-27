# QA checklist · Support & diagnostics

Covers the acceptance criteria of docs/modules/support.md: one zip on the Desktop with the
logs, the settings and a system report and nothing secret; a feedback issue that already
carries the three versions; two repairs that finish in one press; a channel Rust reads back
and a check that only happens on request. The service — the bundle's contents and naming, the
system report, the refusals, the links, the changelog candidates, the settings round trip — is
covered by `tests/support.rs` against the fake platform with temp folders and a pinned clock;
the HUD repair by `tests/hud.rs`; the panel, the pane and the changelog parser by their
Vitest files. This checklist is the desktop and visual side.

## Running it

1. Start Muna (`scripts\dev.ps1`). Open the notch and pick _Support_ in the module bar.
2. Drive the panel (rows 1–9), the pane (rows 10–15), then the repairs against a real fault
   (rows 16–17).
3. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Open the panel | a caption _Muna x.y.z · Windows 11 Pro (build NNNNN)_ matching `winver`, then six rows: _Help_, _Send feedback_, _Save diagnostics_, _What's new_, _Repair_, _Rate Muna on GitHub_; the list scrolls inside the panel, the caption stays |
| 2 | Press _Help_ | the browser opens the docs index on GitHub; the notch collapses as it does for any link |
| 3 | Press _Send feedback_ | the browser opens a new GitHub issue with the `bug` label and a body already naming the Muna version, the OS line from row 1 and the WebView2 version; nothing else about the machine or the account |
| 4 | Press _Save diagnostics_ | the row reads _Saving to your Desktop_ for the moment it takes, then the status line under the list reads _Saved muna-diagnostics-YYYYMMDD-HHMM.zip to your Desktop. Attach it to your issue._ and the file is on the Desktop |
| 5 | Open the zip | `README.txt`, `system.txt`, `settings.json`, `logs/` with every `.log` from the profile; `system.txt` repeats row 1 and lists the started modules; a search of every file for a code-hosting token, a feed URL or a notification body finds nothing |
| 6 | Press _Save diagnostics_ again within the same minute | a second file with a `-2` suffix; nothing overwritten |
| 7 | Press _What's new_ in a build that ships `CHANGELOG.md` (a release or `--release` build after E4) | the view swaps in place with _Back_ and _What's new_; each release shows its version and date, its groups and one line per change with no commit hashes, links or asterisks; _Release notes on GitHub_ at the end; _Back_ returns to the list |
| 8 | Press _What's new_ in a dev build without a changelog | the browser opens the releases page; the panel does not change |
| 9 | Press _Rate Muna on GitHub_ | the browser opens the repository |
| 10 | Open Settings → Support | _Update channel_ with _Stable_ selected; _Check for updates_ reading _You have version x.y.z. Muna only checks when you ask._; _System_ with the OS and WebView2 lines; _Save diagnostics_ with _N MB of logs_ (or _KB_) matching the folder's size; _Logs folder_; the two repairs |
| 11 | Choose _Beta_ | saves; `settings.json` gains `"support": { "channel": "beta", … }`; the panel's caption is unchanged (the channel is not shown there) |
| 12 | Press _Check_ online | after the round trip the row reads either _Version x.y.z is the latest._ or _Version a.b.c is available on GitHub._ with a _Get it_ button that opens the releases page; nothing downloads, nothing installs |
| 13 | Press _Check_ offline | _Updates could not be checked. Check your connection and try again._; the row recovers on the next press |
| 14 | Press _Save_ on the bundle row, then _Open_ on _Logs folder_ | the status line under the pane names the zip; Explorer opens the logs folder |
| 15 | Set the Desktop to a folder that does not exist (`HKCU\…\User Shell Folders\Desktop`), sign out and in, press _Save diagnostics_ | _Your Desktop folder cannot be found, so the bundle was not saved._; no partial file anywhere |
| 16 | With _Volume in the notch_ on, change the volume, then press _Repair_ on _Volume and brightness flyouts_ | Windows's own flyout appears once, then the notch takes over again on the next key press; the status reads _Flyouts repaired._ |
| 17 | In Reserved mode, kill and restart `explorer.exe`, notice maximised windows now cover the strip, press _Repair_ on _Reserved space_ | maximised windows shrink back under the notch within a second; the status reads _Reserved space repaired._ |
| 18 | Tab through the panel and the pane | every row and button is reachable, the focus ring is visible, the status line is announced by Narrator when it changes (`role="status"`) |
| 19 | Reduce motion on | the panel and its sub-views fade only |

## Results

| Build | Date | Machine | Rows passed | Notes |
| ----- | ---- | ------- | ----------- | ----- |
| | | | | |
