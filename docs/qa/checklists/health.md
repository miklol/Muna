# QA checklist · Health

Covers the acceptance criteria of docs/modules/health.md: the rings animate with a spring on
change, the weekday dots reflect goals met, and no break reminder appears while a fullscreen
app or a presentation is in front. The time logic — sits, short and long absences, lock and
sleep, the interval, snooze and dismiss, the deferral, the flows and what they count, the
day boundary, the streak, the hearing clock, retention — is covered by `tests/health.rs`
against the fake platform and a pinned clock; this checklist is the desktop, timing and
visual side, and rows 1–6 need a stopwatch beside the machine.

## Running it

1. Start Muna (`scripts\dev.ps1`). Settings → Health shows *Track sitting and remind me to
   take breaks* on, *Remind me every 50 min* (*Sets a goal of 7 breaks a day*), *Water goal 8
   glasses*, *Breathing pattern Box 4-4-4-4*, *Wind down in the evening* off, *Warn me about
   loud headphones* on.
2. For rows 1–6 set *Remind me every* to 15 min so a reminder is reachable.
3. Drive the sit and the reminder (rows 1–9), the panel (rows 10–17), the flows (rows 18–27),
   the goals and data (rows 28–33), hearing and evening (rows 34–36), the widget, motion and
   restart (rows 37–40).
4. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Type or move the mouse now and then for 5 minutes by the stopwatch, then open the panel | the head reads *Sitting for 5 min* (±30 s: one tick) and the chip *10 min*; *Active* under *Today* grew by the same |
| 2 | Leave the panel open for a minute | *Sitting for* moves up by one minute and the chip down by one, changing on the second; nothing else in the panel moves |
| 3 | Leave the mouse and keyboard alone for 4 minutes, then open the panel | the head reads *Away from the desk*; the chip is gone; *Active* did not grow past the moment input stopped; the widget says the same |
| 4 | Move the mouse again | the head reads *Sitting for 0 min* a moment later: a fresh sit; if the sit before was over 10 minutes *Breaks* counted one and the green ring grew |
| 5 | Step away for one minute only, come back | the sit continues where it was (*Sitting for N min* did not reset) |
| 6 | Sit past the interval (15 min) | the strip shows *Time for a break · sitting 15 min* with the heart, and holds about 8 s; the panel head shows *Time for a break* in pink and the flows lead with the reminder card, *Snooze* and *Dismiss*; the widget reads *Time for a break* |
| 7 | *Snooze* | the reminder card goes; the chip reads *10 min*; ten minutes later the notice is back |
| 8 | *Dismiss* | the reminder card goes; the chip reads the full interval again |
| 9 | Play a video fullscreen (YouTube F, or a slideshow) across the interval, then leave fullscreen | no notice while fullscreen (the notch is parked); the reminder shows within 5 minutes of leaving fullscreen |
| 10 | Open the panel mid-afternoon | head: the heart, *Sitting for N min*, the next-break chip, *Settings*; three columns — *Today* (Active, Longest sit, Breaks, Mindful, *N-day streak*), *Goals* (three rings, green outside, blue, purple inside; the weekday dots, today last and marked; the counters with the water − and +), *Take a break* (Move, Breathe, Stretch, Eye rest cards, each with its length or rhythm) |
| 11 | Tab through the panel | the focus ring lands on *Settings*, the water − and +, then each flow card in order; every card's name reads *Start Move* and so on; the rings read *4 of 7 breaks*, *7 of 8 glasses*, *0 of 10 mindful minutes* to assistive technology |
| 12 | Lock Windows (Win+L) for 2 minutes, unlock, open the panel | the head reads *Locked* during the lock (visible on the next open only as an unchanged *Active*); after the unlock a fresh sit counts from the unlock |
| 13 | Sleep the machine for 5 minutes, wake | *Active* did not grow across the sleep; the sit ended at the last tick before it |
| 14 | Settings → *Track sitting* off, open the panel | *Health is off · Turn it on in Settings to track sitting and get break reminders.* with *Open Settings*; no rings, no flows; the widget reads *Health is off* and its + is disabled |
| 15 | Turn it back on | the sit starts from the switch; the counters are as they were |
| 16 | *Settings* in the head | the settings window opens on Health |
| 17 | The panel at its minimum width | the three columns stay side by side (the first is at least 148 px, the last 220 px); the facts and the card captions truncate with an ellipsis, and the numbers never wrap |
| 18 | Click *Start Move* | the columns give way to the flow view: the footprints and *Move* in the head, *3:00 left* chip and *Stop*; a 112 px ring counting down with *Stand up and walk a few steps*; the strip shows the Timer glyph with *3:00* counting down; the panel is pinned (the pointer leaving does not close it, the pin button stays unlit) |
| 19 | Wait 30 s | the prompt changes to *Roll your shoulders back, slowly* and the dots advance; the ring and the strip agree within a second |
| 20 | Move the pointer away, then `Esc` | the panel stays while the pointer leaves; `Esc` closes it; the strip keeps the countdown; opening the panel again shows the flow still running and pinned |
| 21 | Let Move finish | the strip shows *Nice, you moved* with the heart for about 4 s; the panel returns to the columns; *Breaks* counted one and the green ring grew with a spring; the sit reads *Sitting for 0 min* |
| 22 | *Start Breathe* (Box) | the circle grows over 4 s on *Breathe in*, holds 4 s, shrinks 4 s on *Breathe out*, holds 4 s; *Round 1 of 8*; the phase text and the circle agree; the strip counts *2:08* down |
| 23 | Settings → *Breathing pattern* → *Relax 4-7-8*, then *Start Breathe* again | *Round 1 of 6*; in 4 s, hold 7 s, out 8 s; *1:54* in the strip |
| 24 | Let Breathe finish | *Breathing done* in the strip; *Mindful* reads *2 min* and the purple ring grew; *Breaks* did not count |
| 25 | *Start Stretch* | the six steps in a list, the current one marked and the done ones dimmed as the minutes pass; *2:00* in the strip; finishing counts a break and reads *Stretch done* |
| 26 | *Start Eye rest* | *Look at something far away, about 20 feet, until the timer ends.* with the 20 s ring; no full-screen overlay; *Eyes rested* at the end; no break counted |
| 27 | *Stop* during any flow | the columns are back at once; the strip countdown is gone; nothing counted; the panel is no longer pinned (the pointer leaving closes it) |
| 28 | Water + three times, − once | the counter reads *9 of 8* then *8 of 8*; the blue ring fills with a spring and stays full past the goal; the widget agrees at once |
| 29 | Settings → *Water goal* to 10 | the counter reads *8 of 10*; the ring eases back |
| 30 | Settings → *Remind me every* to 30 min | the description reads *Sets a goal of 12 breaks a day*; the green ring's goal follows in the panel |
| 31 | Meet one goal (water) before midnight, check the dots after midnight | yesterday's dot is one-third filled and reads *Weekday, 1 of 3 goals met*; *1-day streak*; today's dot is empty and marked |
| 32 | Settings → *Reset today* | *Today is reset.*; Breaks, water and Mindful read 0 in the panel; the sit keeps counting |
| 33 | *Clear history* → *Cancel*, then *Clear history* → *Clear* | the question *Clear the whole history?* appears and goes; on *Clear*: *History cleared.*, the week dots are empty, the streak is gone, the settings are unchanged |
| 34 | Headphones (Bluetooth, or a wired headset the system names *Headphones*), volume to 90 %, play audio for 11 minutes | the strip shows *Loud for 10 min · 90 %* once with the volume glyph; the panel's *Today* column shows the orange *Loud on headphones: 90 % for 10 min. Turn it down a little.*; at 80 % or with speakers nothing shows; muting resets the clock |
| 35 | Settings → *Warn me about loud headphones* off, repeat row 34 for 2 minutes | nothing shows |
| 36 | Settings → *Wind down in the evening* on (the hour slider appears at *9:00 PM*), set the hour to the current hour | the panel head shows the purple *Winding down* chip; off again removes the slider and the chip |
| 37 | Dashboard → *Add a widget* → Health | the card shows the three rings small, *Sitting N min* over *Next break in N min* (or *Time for a break*; *Move running* over *2:41 left*; *Away from the desk*, *Locked* or *Health is off* over the water count), and the + logs a glass |
| 38 | Reduced motion (Windows *Animation effects* off) | the rings appear without the draw-in and jump to new values; the breathing circle stands still and the phase text carries the rhythm; the flow view swaps in with a fade |
| 39 | Task Manager → Details, sort by CPU, leave the panel closed for five minutes while sitting | `muna.exe` and `notch.exe` together stay under 0.3 % CPU; away from the desk the process wakes for nothing |
| 40 | Restart Muna | today's Active, Longest sit, Breaks, water and Mindful, the week and the streak are as they were (at most 5 minutes of Active lost); a fresh sit starts |
| 41 | Windows 10 22H2 | rows 1, 3, 9, 12 and 34 |

## Results

| Build | Date | Rows passed | Notes |
| ------- | ------ | ------------- | ------- |
| — | — | — | not yet run on real Windows: fill this table with the first run |
