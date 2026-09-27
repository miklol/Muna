# QA checklist · Screen time

Covers the acceptance criteria of docs/modules/screen-time.md: data never leaves the machine
and exports as CSV, attribution stays within 2 % of a manual log over an hour, and the hook
costs under 0.1 % CPU. The span logic — foreground changes, idle pause and resume, lock and
unlock, the day boundary, sleep gaps, flushes, limits, retention, exclusions, categories and
the CSV — is covered by `tests/screen_time.rs` against the fake platform and a pinned clock;
this checklist is the desktop, timing and visual side, and rows 1–4 need a stopwatch (or a
manual log) beside the machine.

## Running it

1. Start Muna (`scripts\dev.ps1`). Settings → Screen time shows *Count screen time* on, *Pause
   after 5 minutes*, *Day starts at 12:00 AM*, *No excluded apps*.
2. Have Notepad, a browser and a terminal open.
3. Drive attribution (rows 1–7), the panel (rows 8–18), limits and exclusions (rows 19–24),
   the pane and data (rows 25–31), the widget and motion (rows 32–34).
4. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Bring Notepad to the front and hold it there for 10 minutes by the stopwatch, then open the panel | the *Now* card reads *Notepad · Productivity · since hh:mm* with the time the switch happened; Notepad's row reads *10 min* (±12 s: one tick of error) |
| 2 | Switch Notepad → browser → terminal → Notepad every 30 s for 6 minutes | the switches chip counts every change (12); each app's total is within 2 % of the log; the head chip total equals the sum |
| 3 | Leave the mouse and keyboard alone for 6 minutes with Notepad in front, then move the mouse and open the panel | the card read *Away · Time stops counting until you are back.* while idle; Notepad's total grew by ≤ 5 min 10 s (the count paused at the moment input stopped, not when the threshold passed); it counts again from the mouse move |
| 4 | Lock Windows (Win+L) for 2 minutes with the browser in front, unlock | *Locked* during the lock (the panel is not open, so the state is visible on the next open only as an unchanged total); the browser's total did not grow; after the unlock the browser counts from the unlock moment |
| 5 | Sleep the machine for 5 minutes, wake, open the panel | the open span ended at the last flush before the sleep (at most 60 s over); the *Now* card resumes with the app in front |
| 6 | Open Muna's settings window and keep it in front for a minute | Muna does not appear in the ranking (own windows never count); the previous app's span closed |
| 7 | Task Manager → Details, sort by CPU, wait five minutes with the panel closed | `muna.exe` and `notch.exe` together stay under 0.1 % CPU; the `ci:app` idle numbers are unchanged with the module on |
| 8 | Open the panel after a day with several apps | head chips *N h N min today* and *N switches*; the *Week* chip and *Settings*; the donut with the total inside and the legend listing only the categories with time, dots in the category colours; *Average session* and *Longest session* below the legend; the *Now* card; the ranking with an icon, the name, the duration and a bar of the leader's share per row |
| 9 | Hover a ranking row | the row's background lifts; the whole row is one button whose accessible name is *Name, duration* |
| 10 | Click a ranking row | the details replace both columns: *Back to today*, the icon, the name, *total · N sessions · Longest N min*; *Category* chips with the current one pressed; *Daily limit* chips (*None* pressed); *Exclude this app* |
| 11 | *Back to today* | the overview is back with the same layout |
| 12 | *Week* chip | the columns give way to seven stacked bars, oldest left, today right and bold; each bar's height is its share of the busiest day, stacked by category; *Daily average N h N min* over the days that have time; hovering a bar's column says *Weekday, N h N min* to assistive technology; the *Week* chip shows pressed; clicking it again returns to today |
| 13 | First run of the day, nothing in front yet | the *Now* card reads *Nothing yet · Switch to another app to start the count.*; the head chip reads *0 min today*; the donut is an empty track; *No apps yet today* in place of the ranking |
| 14 | Settings → *Count screen time* off, open the panel | *Screen time is off · Turn it on in Settings to start counting.*; the totals stay as they were; nothing accrues |
| 15 | Turn it back on | the app in front counts from the moment of the switch |
| 16 | An app with a long name (a 60-character window title app) | the name ends in an ellipsis in the row, the card and the details; the duration never wraps |
| 17 | A UWP app (Calculator, Photos) in front | it counts as one *ApplicationFrameHost* row under *System* (per-package attribution is deferred) |
| 18 | Leave the panel open for a minute | the *Now* card's *since* time does not change; totals and bars move every 10 s; the switches chip does not count the notch |
| 19 | Details of the browser → *Daily limit* → *15 min* with the browser already over 15 minutes today | the chip shows pressed; the line under the chips reads *Limit reached*; back in the ranking the browser's bar is orange and full, and its accessible name is *Browser, N min of a 15 min limit* |
| 20 | Set a limit the app has not reached, then keep the app in front until it does | the strip shows *App · 15 min limit reached* once (the notice describes itself as *App reached its daily limit of 15 min*); the panel row turns orange; the notice does not repeat today |
| 21 | Details → *Daily limit* → *None* | the bar is the leader's share again, blue; the line under the chips reads *The notch nudges you once when the app passes this today.* |
| 22 | Details → *Category* → *Games* on the browser | the row's bar and legend dot move to orange; the legend gains *Games* and loses *Browsing* if the browser was its only app; a restart keeps the choice |
| 23 | Details → *Exclude this app* | the details close; the app is gone from the ranking and the donut; its time is gone from the total; Settings → *Excluded apps* lists it; it does not come back while in front |
| 24 | Settings → *Excluded apps* → *Include* | the row is gone from the pane; the app counts again from now on (its history stays forgotten) |
| 25 | *Pause after* slider to 1 minute, leave the machine for 90 s | the card reads *Away* and the count paused after one minute; the pane reads *1 minute* |
| 26 | *Day starts at* to the current hour + 1, wait for the hour | the head chip total resets at that hour; the previous day's bar in *Week* holds the earlier time; *Week* labels are unchanged |
| 27 | *Export CSV*, pick a folder | Explorer opens on `muna-screen-time-YYYY-MM-DD.csv`; the pane says *Saved to …* with the full path; the file has the header `start,end,exe,app,category,seconds` and one row per span with local ISO times; no window titles anywhere in it |
| 28 | *Export CSV*, cancel the picker | nothing is written; the pane says nothing |
| 29 | *Export CSV* to a read-only folder | *The file could not be written. Choose another folder and try again.* |
| 30 | *Clear history*, then *Cancel* | the question *Delete all screen time history?* appears and goes away; nothing changed |
| 31 | *Clear history*, then *Clear* | the panel shows *0 min today* and *No apps yet today*; the week is empty; the excluded apps, the categories and the limits are still set; the app in front counts from now |
| 32 | Dashboard → *Add a widget* → Screen time | the card shows the small donut, the total and the app in front (*Away* / *Locked* while paused, *Off* when off, *Nothing yet* at the start of the day); a wide card adds the three leading apps with durations |
| 33 | Reduced motion (Windows *Animation effects* off) | the donut and the bars appear without the draw-in; the overview ↔ details swap is a fade with no travel |
| 34 | Restart Muna | today's totals, the week, the limits, the categories and the exclusions are all as they were (at most the last flush lost) |
| 35 | Windows 10 22H2 | rows 1, 3, 4, 17 and 27 |

## Results

Recorded per run; the first pass is in the M4-E8 PR description.
