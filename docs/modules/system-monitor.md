# System Monitor ("System Analytics")

**Tier P1 · Owner: `muna-shell-engineer` · Status: spec**

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
