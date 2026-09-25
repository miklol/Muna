# System Monitor ("System Analytics")

**Tier P1 · Owner: `muna-shell-engineer` · Status: implemented (M3-E8; GPU and temperatures
deferred — see [Implementation notes](#implementation-notes-m3-e8))**

## Reference

`demo-22`. 3×2 grid of gauges: CPU %, Memory (used/total), Storage %, Network KB/s, Battery %,
Free Disk GB; ring gauge + big value + secondary text.

## Platform

`sysinfo` crate for CPU/RAM/disks/network (refresh 1 s while visible, 10 s while collapsed
with strip gauge, off otherwise); `Windows.Devices.Power.Battery.AggregateBattery` for charge
and rate; optional GPU via `D3DKMTQueryStatistics` or NVML (flag); temperatures need admin →
out of scope v1. Process top-5 list in expanded height.

## Acceptance criteria

- Sampling never exceeds 0.5 % CPU; stops when the module is not visible and not in the strip.
- Values match Task Manager within ±3 %.

## Implementation notes (M3-E8)

Pieces, in the order the data flows:

- **Platform** (`muna-platform::SystemStats`, pull-based): `sample(top_processes)` returns one
  `SystemSample` — CPU % (PDH `% Idle Time` counters), memory (`GlobalMemoryStatusEx`), every
  volume with its mount, capacity, free space and whether it is the system or a removable
  volume, the network byte totals since the previous call (hardware interfaces only), and the
  busiest processes grouped by executable name with their CPU share normalised to the whole
  machine. The `sysinfo` handles are created on the first sample, because opening the PDH
  query is the slow part and a machine that never opens the panel should not pay for it.
  `FakePlatform::script_system_samples` plays readings in order and repeats the last one;
  `system_sample_requests` records how often the module sampled and with which process count.
- **Service** (`src-tauri/src/modules/system_monitor`): one task per app that owns the
  cadence. It samples every second while a notch window watches
  (`system_monitor_watch(true)`), every 10 s while only the strip gauge is on, and otherwise
  parks on a `Notify` — nothing runs while the module is neither visible nor in the strip. The
  process walk is requested only while a panel watches. Machine CPU and the network rates are
  differences between consecutive samples over the monotonic clock; the first sample and any
  gap over 30 s (sleep, a long idle) yield "no reading" rather than a number averaged over the
  gap. Storage sums the non-removable volumes with saturating adds; free disk is the system
  volume's available bytes. Battery comes from `Platform::power().battery()`.
- **Strip** (`show_cpu_in_strip`, off by default): the `system-monitor:cpu` activity —
  priority `SYSTEM_GAUGE` 10 (below a paused track), `Cpu` glyph, the percentage in the
  trailing slot, no wide form — republished only when the whole percentage changes and
  retracted when the setting turns off or the reading is missing.
- **Contract**: `get_system_monitor_snapshot`, `system_monitor_watch(watching)` (returns the
  latest reading for the first paint) and the `SystemMonitorChanged` event. The snapshot is
  integers only: byte counts are `u64` saturated to 2⁵³ − 1 through the `Int53` marker,
  machine CPU is a whole percentage, process CPU is in tenths, rates are bytes per second.
  `specta-typescript` exports floats as `number | null` and refuses `u64`, so this is the
  IPC rule for every module ([M0 → IPC rule](../build-plan/m0-foundations.md)).
- **Panel** (`apps/desktop/src/modules/system-monitor`): six `Ring` tiles (36 px, stroke 6)
  — CPU (blue), memory (green), storage (cyan), network (blue), battery (green; orange ≤ 20 %,
  red ≤ 10 %), free disk (cyan) — each with a label and glyph, the value in `title3` tabular
  and a detail line; beside them a real `<table>` of the busiest processes (name with an `×N`
  instance count, CPU, memory). Mounting starts the 1 Hz sampling and unmounting stops it; the
  panel holds no timers. Before the first reading every tile shows "—" and "Reading…". The
  network ring draws the current total against the busiest moment seen in the session, never
  against less than 128 KiB/s, since a rate has no natural maximum. Byte counts use binary
  divisors under `Intl` decimal labels ("15.9 GB" here is "15.9 GB" in Explorer).
- **Settings** (`settings.modules["system-monitor"]`, zod mirror in `@muna/contracts`): show
  CPU in the strip (off) and processes shown 0–10 (default 5; 0 hides the table and skips the
  process walk).
- **Tests**: `tests/system_monitor.rs` (17; `FakeClock` + scripted samples) covers the
  cadence, the process count, the rates and the 30 s window, storage and free disk, battery,
  `Int53` saturation, the strip gauge and the settings; `muna-platform` unit tests cover the
  fake and (behind `platform-tests`) one live sample; Vitest covers the formatters, the gauge
  builder, the panel with its watch/unwatch round trip, and the settings pane.

Deviations from the spec above, decided in M3-E8:

- **GPU and temperatures are out.** `D3DKMTQueryStatistics` is undocumented and NVML is
  vendor-specific; both wait for a flag and an epic of their own. Temperatures need admin.
- **Task Manager parity is approximate.** Windows 11's headline CPU is "% Processor Utility"
  (frequency-scaled); ours is `100 − % Idle Time`, the classic reading, so the two can differ
  by more than 3 % on a boosting laptop. Per-process memory is the working set, which reads
  higher than Task Manager's private working set. Both are documented on the types.
- **Battery comes from `GetSystemPowerStatus`, not `AggregateBattery`.** The power layer
  already had the percentage and the charging flag from the Win32 status; the WinRT
  `AggregateBattery` (with its charge and discharge rate) comes with the Day Progress or
  battery epic that needs a rate. The panel shows the percentage and the state.
- **Strip gauge off by default.** A permanently sampling gauge costs the idle budget; the user
  opts in.
