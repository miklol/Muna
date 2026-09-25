# QA checklist · Volume / brightness HUD

Covers the M2 exit criteria "HUD replaces the Windows flyout" and "flyout back within 2 s of a
crash" for the HUD module (docs/modules/hud.md). Latencies and the watchdog are measured by
`tests/hud.rs` and the platform suite; this checklist is the hardware and visual side.

## Running it

1. Start Muna (`scripts\dev.ps1`) with *Replace system flyout* on (the default).
2. Press the keyboard's volume keys and, on a laptop, the brightness keys. Use the mouse wheel
   and a drag over the strip for the interaction rows.
3. For the crash row, end the process from Task Manager (or `Stop-Process -Id <pid>`), then
   press a volume key: the Windows flyout must appear.
4. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Volume key | strip shows speaker glyph + 96 px track, fill at the new level; the Windows flyout stays hidden; both gone 1.5 s after the last press |
| 2 | Repeated presses | fill moves; the track does not re-enter; the glyph crossfades between wave counts (0–3) |
| 3 | Mute key | slash glyph, fill drains; unmute (or volume up) refills |
| 4 | Brightness key (laptop) | sun glyph + track; fill follows |
| 5 | Mic mute key or Settings switch | mic glyph only, no track |
| 6 | Wheel over the strip while the volume HUD shows | volume moves 2 % per notch; the panel does not open |
| 7 | Wheel over the idle strip, *Scroll on strip = panel* | scroll down opens the panel as before |
| 8 | Wheel over the idle strip, *Scroll on strip = volume* | volume moves; a press still opens the panel |
| 9 | Drag the volume track | level follows the pointer live; the panel does not open |
| 10 | Drag the brightness track (one display) | level applies on release |
| 11 | *Show level text* on | percentage beside the track, tabular digits |
| 12 | Settings → Volume and brightness | *Status* says "Hidden while Muna runs"; mute switches and brightness sliders match the OS |
| 13 | *Replace system flyout* off | Windows flyout returns on the next key; the HUD still shows |
| 14 | Kill Muna, then a volume key | Windows flyout visible within 2 s |
| 15 | Windows 10 | rows 1 and 14 (`NativeHWNDHost` flyout) |
| 16 | External monitor with DDC/CI | row 4 with the external display; an incapable monitor is not listed |

## Results

Recorded per run; the first pass is in the M2-E3 PR B description.
