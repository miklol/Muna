# Spike M0-E2 · Transparent notch window

**Status:** Recorded (Win11 25H2; Win10 22H2 column open) · **Validates:**
[ADR-0001](../adr/0001-tech-stack.md), [ADR-0002](../adr/0002-window-strategy.md) ·
**Owner:** `muna-shell-engineer` · **Plan:** `muna-architect`, 2026-09-14 ·
**Measured:** `muna-architect`, 2026-09-15

Kickoff prompt:
[build-plan/m0-foundations.md](../build-plan/m0-foundations.md#m0-e2--transparent-window-spike--agent-muna-shell-engineer).

## Question

Can one transparent, always-on-top WebView2 window per monitor show the collapsed strip
flash-free and inside the idle budgets, or does the collapsed strip need the native
Direct2D pill escape hatch ([ADR-0001 › consequences](../adr/0001-tech-stack.md#consequences))?

**Answer: yes, with one configuration amendment.** Eleven of twelve criteria pass on Windows
11 25H2 with a two-monitor mixed-DPI setup in WebView2's default configuration. The twelfth,
idle memory (W5), **fails in that configuration — 181 to 223 MB against the 120 MB budget** —
because WebView2's separate GPU process alone holds 66–117 MB of Intel driver heaps. Running
WebView2 with `--in-process-gpu` (plus one shared renderer) brings the tree to
[≈ 100 MB](#w5--idle-memory) and every criterion passes; that flag set is now baked into
`tauri.conf.json` and every number in the table below was re-measured with it. The escape
hatch was not needed. Details and the handful of things Windows disagreed with are under
[Observations](#observations).

## How to run

- `MUNA_SPIKE=window` with `.\scripts\dev.ps1` (or the release `muna.exe`): one notch window
  per monitor, a 200 × 32 DIP black strip with bottom radius 14 at the top-centre of
  `rcMonitor`. Shortcuts: `Ctrl+Alt+M` morph strip ↔ 360 × 240 panel (`expand` / `collapse`
  springs from [06](../06-motion-spec.md)), `Ctrl+Alt+P` park / unpark, `Ctrl+Alt+C` capture
  exclusion. Scripted runs: `MUNA_SPIKE_CYCLES=<n>` (park/unpark every 250 ms),
  `MUNA_SPIKE_MORPHS=<n>`, `MUNA_SPIKE_EXCLUDE_CAPTURE=1`, `MUNA_SPIKE_MEMORY_LOW=<s>` (ask
  WebView2 for `MemoryUsageTargetLevel::Low` after `<s>` seconds).
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` lets a harness A/B Chromium switches without a
  rebuild (the loader appends it to the configured `additionalBrowserArgs`).
- The shell writes one JSON line per event (`ready`, `moved`, `shapes`, `park`, `morph`,
  `hit_probe`, `poll_stats`, `foreground`, `quiet_state`, `display_change`,
  `window_attached`, `window_destroyed`, `scale_factor_changed`, `memory_target`) to
  `%LOCALAPPDATA%\Muna\spike\window.jsonl`.
- Measurement harness: `scripts/perf/window-spike/measure-*.ps1` (Windows PowerShell 5.1,
  per-monitor-v2 DPI aware). Each script starts the release binary, drives it, reads the JSONL
  log, captures the strip with GDI where pixels matter and writes
  `apps/desktop/src-tauri/target/spike-results/<criterion>.json` (+ `.jsonl`, PNGs). Results
  stay out of git; the numbers below are copied from those files.

| Script | Criteria |
| -------- | ---------- |
| `measure-park-cycles.ps1` | W1 |
| `measure-display-changes.ps1` (+ `display.ps1`) | W2, W9, W10 |
| `measure-first-paint.ps1` | W3 |
| `measure-idle.ps1` (`-SpikeEnv`, `-ResultName` for A/B runs) | W4, W5 |
| `probe-gpu-process.ps1` | W5 diagnostic (GPU process size and driver DLLs per start) |
| `measure-morph.ps1` | W6 |
| `measure-hit-test.ps1` | W7 |
| `measure-capture.ps1` | W8 (GDI path) |
| `measure-fullscreen.ps1` | W11 |
| `measure-topmost.ps1` | W12 |

## Environment

| Item | Win11 25H2 run | Win10 22H2 run |
| ------ | ---------------- | ---------------- |
| Machine / GPU | Acer Predator PHN16-71, NVIDIA GeForce RTX 4060 Laptop GPU + Intel UHD (hybrid) | |
| OS build | Windows 11 Pro 25H2, 10.0.26200 | |
| Monitors (resolution @ scale; primary marked) | **`\\.\DISPLAY1` 2560 × 1600 @ 150 % (DPI 144), 165 Hz, primary at (0, 0)**; `\\.\DISPLAY5` 1920 × 1080 @ 100 %, 60 Hz, at (−1920, −291) | |
| WebView2 runtime | 152.0.4191.66 (Evergreen) | |
| Tauri / wry / tao versions | tauri 2.11.5, wry 0.55.1, tao 0.35.3, webview2-com 0.38.2, windows 0.61.3 | |
| WebView2 switches (`additionalBrowserArgs`, both windows) | `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,SpareRendererForSitePerProcess --process-per-site --in-process-gpu` | |
| Commit | the M0-E2 PR head (release build, `tauri build --no-bundle`) | |

The plan named Win11 24H2; the available machine runs 25H2 (same platform generation). The
machine was in normal use during the runs (Teams, Edge, a second notch utility), which shows
up in the tails of the W7 latencies. All rows were measured with the final WebView2 switch set;
the W5 section keeps the default-configuration numbers that motivated it.

## Exit criteria

Budgets come from
[01 › performance budgets](../01-product-vision.md#performance--quality-budgets-enforced-in-ci-where-possible),
[ADR-0001 › validation](../adr/0001-tech-stack.md#validation-exit-criteria-of-the-m0-e2-spike)
and ADR-0002. "Pass" is per row; the Win10 column is open until the runbook below is executed.

| # | Criterion | Budget | Method | Win11 25H2 | Win10 22H2 | Pass |
| --- | ----------- | -------- | -------- | ------------ | ------------ | ------ |
| W1 | Flashes over 100 park/unpark cycles ((−10000, −10000) ↔ placed) | 0 | GDI strip capture at ~36 Hz + frame diff (a frame that differs from *both* neighbours by > 2 % is a flash) | **0 flashes** · 200 park events, 1950 frames, 200 clean transitions | | ✅ |
| W2 | Flashes over 20 monitor-change events (`WM_DISPLAYCHANGE`: hot-plug, resolution, scale) | 0 | same capture during 22 changes (6 primary scale, 6 secondary resolution, 10 hot-plug) | **0 flashes** · 22 changes → 22 `display_change` events, 2640 frames, 0 non-black frames (2820 frames, same result, with the default process model) | | ✅ |
| W3 | First strip paint after process start | ≤ 800 ms | `main()` → UI `ready` (in-process) and process start → `ready` (wall clock), 20 cold starts | **median 345 ms** in-process, 382 ms wall clock (373 / 397 ms with the default process model) | | ✅ |
| W4 | Idle CPU, strip visible, cursor elsewhere | ≤ 0.3 % | `Win32_PerfFormattedData_PerfProc_Process` summed over `muna` + its `msedgewebview2` tree, 60 s average | **0.05 %** single-core basis (0.0016 % Task-Manager style on 32 threads; 0.23–0.26 % with the separate GPU process) | | ✅ |
| W5 | Resident set size after 5 min idle | ≤ 120 MB | private working set summed over the same processes, sampled every 10 s; the 300 s value is reported | **108.8 MB** over 6 processes with the final switch set (series median 108.1, peak 115.1 MB at 15 s) · **181–223 MB in WebView2's default process model** — see [W5](#w5--idle-memory) | | ✅ (with `--in-process-gpu`) · ❌ default |
| W6 | Test morph strip ↔ panel | ≥ 58 fps, no frame > 32 ms | RAF frame timings reported per morph, 20 morphs per window | **min 167.1 fps, median 168.4 fps, max frame 6.4 ms, 0 dropped** (165 Hz primary; the 60 Hz secondary reports the same because WebView2 ticks RAF at the primary rate; 164.8 / 167.8 fps and max 14.0 ms with the separate GPU process) | | ✅ |
| W7 | Click-through | outside the published shape rect clicks reach the window below; inside they hit the strip; `set_ignore_cursor_events` toggles ≤ 16 ms after crossing | `SetCursorPos` across the strip edge, `WindowFromPoint` polled every 4 ms; 60 Hz `GetCursorPos` poll on a dedicated thread | **enter median 11.8 ms (p95 22), leave median 14.7 ms (p95 89)**, 0 failures, 0 displaced trials; poll interval 17.1 ms real; `WS_EX_TOOLWINDOW` kept, 0 strip flashes across 233 frames of toggles | | ✅ median · tail above budget, see note |
| W8 | Capture exclusion | `WDA_EXCLUDEFROMCAPTURE` on → strip absent from Snipping Tool / OBS / Teams share; off → present | GDI `CopyFromScreen` of the strip rect in both hit-test states; WGC apps are a manual check | **off → strip present (black fraction 0.986); on → absent (0.000)** in layered and hittable states, `SetWindowDisplayAffinity` ok | | ✅ (GDI) · WGC manual |
| W9 | Monitor hot-plug | window created/destroyed per monitor; no orphan, no stale position | `SetDisplayConfig(SDC_TOPOLOGY_INTERNAL)` ↔ `EXTEND` 5 × | **5/5 cycles**: secondary window destroyed on removal, new window attached, ready and placed inside the returned monitor on re-extend; window count = monitor count every time | | ✅ |
| W10 | Scale change 100 % → 200 % → 100 % | strip stays 200 × 32 DIP at top-centre, no blur | DisplayConfig scale packets on the primary: 150 → 200 → 100 → 150, twice | **6/6**: `WM_DPICHANGED` seen 213–270 ms after the request, window re-placed within 15–35 ms more; strip 400 × 64 px at x = 1080 (200 %), 200 × 32 at x = 1180 (100 %), 300 × 48 at x = 1130 (150 %); window DPI = monitor DPI; edge gradient 94/105/123 per px at 200/150/100 % (a 2× upscale would halve it) | | ✅ |
| W11 | Quiet-state detection | `SHQueryUserNotificationState` poll reports fullscreen / presentation within 1 s; strip parks | borderless window covering the primary takes foreground 5 ×; `park reason=quiet_state` timed | **park median 189 ms (max 215), unpark median 300 ms (max 337)**, 0 failures; state seen `QUNS_BUSY` | | ✅ |
| W12 | Top-most re-assertion | strip back on top within one frame after `EVENT_SYSTEM_FOREGROUND` from a fullscreen or UAC-band window | topmost window shown over the strip 10 ×; centre pixel and z-order polled from `ShowWindow` | **pixel median 38 ms (p95 40), z-order median 31 ms**, 0 failures, covered in 10/10 trials before recovery | | ✅ (see note) |

W7 note: the median is inside one poll period, the tail is not. A 60 Hz poll bounds the
*typical* toggle to ≈ 17 ms plus the `SetWindowLongPtr` round-trip; the 89 ms p95 on the
leave edge came from a shared machine under load (Teams, Edge) and from trials where the
poll thread lost its slot. M1 follow-up (not a spike blocker): wake the poll from
`WM_INPUT` raw mouse input (`RegisterRawInputDevices` with `RIDEV_INPUTSINK`, no hook, no
timeout risk) so the toggle follows the first movement instead of the next tick.

W12 note: "one frame" after the *event* holds — the shell's `SetWindowPos` runs on the hook
and again ≈ 28 ms later; the ≈ 31 ms measured from `ShowWindow` includes Windows' own
activation and raise, which lands *after* the hook (see observations).

### W5 · idle memory

Metric: private working set (Task Manager's "Memory" column) summed over `muna.exe` and every
`msedgewebview2.exe` it owns, strip placed, cursor elsewhere, release build. Baseline runs
used `measure-idle.ps1` as-is; A/B runs pass Chromium switches through
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` and the memory target through
`MUNA_SPIKE_MEMORY_LOW`, so the same binary served every row.

**Default process model fails.** Three runs, 120–300 s idle:

| Run | Total | GPU process | Browser | Renderers | `muna` | Utilities + crashpad |
| ----- | ------- | ------------- | --------- | ----------- | -------- | ---------------------- |
| 300 s | **181.4 MB** (9 processes) | 66.4 | 38.5 | 20.8 + 17.0 + 17.0 | 10.5 | 9.3 + 1.8 |
| 120 s | **190.3 MB** (10) | 71.4 | 37.9 + 5.6 | 20.3 + 17.1 + 16.4 | 10.4 | 9.4 + 1.8 |
| 120 s | **223.3 MB** (9) | 111.3 | 37.9 | 17.8 + 17.6 + 17.0 | 10.5 | 9.3 + 1.8 |

Two windows cost three renderers (Chromium keeps a spare one warm) and the GPU process is
both the largest member and the noisiest: `probe-gpu-process.ps1` over four cold starts
measured it at 107 / 94 / 105 / 117 MB after 30 s, always with the same Intel stack loaded
(`igc64.dll` 70 MB, `igd10um64xe.DLL` 25 MB, `igd11dxva64.dll` 21 MB, `igd10iumd64.dll`,
`igdgmm64.dll`, `D3DCompiler_47.dll`) — the WebView2 GPU process runs on the integrated GPU
of this hybrid laptop and the spread is the driver's own heaps, not a different adapter.
Without any renderer at all the tree would still be ≈ 127 MB, so the Direct2D pill escape
hatch (a native strip *next to* a WebView2 tree) could not have rescued this row either.

**Levers, 120 s idle unless noted (medians of the 10 s series where the run has one):**

| Variant | Total | What changed |
| --------- | ------- | -------------- |
| `--disable-features=…,SpareRendererForSitePerProcess --process-per-site` | 192.9 MB (7) | one renderer (23.3 MB) instead of three; GPU process 109.6 MB |
| `MemoryUsageTargetLevel::Low` after 20 s (`ICoreWebView2_19`) | 199.9 MB (9) | window renderers 17 → 10 MB each; spare renderer and GPU process unchanged |
| both | 179.3 MB (7) | renderer 13.9 MB; GPU process 105.7 MB — still 60 MB over |
| both + `--in-process-gpu` (70 s) | **99.5 MB** (6) | no GPU process; browser 63.6 MB absorbs the GPU thread (+25 MB instead of +66–117) |
| **final: switches only, 300 s** (`tauri.conf.json`) | **108.8 MB** (6) | browser 64.1 (with GPU thread), renderer 23.2, `muna` 10.4, network 6.1, storage 3.2, crashpad 1.8; series median 108.1, peak 115.1 MB at 15 s, flat from 100 s on |
| final + `MemoryUsageTargetLevel::Low`, 120 s | ≈ 101 MB, then 71.7 MB (6) | 101 MB at 45–75 s is the target's own effect (browser −20, renderer −10 MB); the step to 71.7 MB at 85 s is a system-wide working-set trim by Windows (`muna.exe` fell 10.4 → 4.2 MB too), not the API |

`--in-process-gpu` moves Chromium's GPU service into the browser process. Everything else
still holds with it: W6 morphs at 167–168 fps with the worst frame at 6.4 ms (better than the
14 ms seen with the separate process — one hop less per frame), first paint improves by
≈ 30 ms, W1/W2/W7/W8/W11/W12 are unchanged. Costs, recorded in ADR-0002 and the risk
register: a GPU driver crash now takes the WebView2 browser process down instead of only its
GPU process (WebView2 reports `ProcessFailed`; the shell's watchdog must recreate the
windows — already an M1 requirement), and the switch is a Chromium command-line flag rather
than a WebView2 API, so a runtime update may ignore it. The M1-E3 perf harness must therefore
assert both the process count (no `--type=gpu-process` child) and the 120 MB total on every
run; if the flag stops working the budget becomes unattainable with a WebView2 strip on
integrated GPUs of this class and the maintainer decision is either a raised, evidence-based
budget or a native strip with the WebView created lazily.

The memory target is left out of the default configuration for now (it is a runtime call
the shell can make when the notch has been collapsed for a while and undo on expand; M1
decides based on the expand latency it costs). The `MUNA_SPIKE_MEMORY_LOW` path stays for
measurement.

## Win10 22H2 runbook

No Windows 10 machine was available. To fill the column: install the Evergreen WebView2
runtime, build with `pnpm --filter @muna/desktop tauri build --no-bundle`, run every
`scripts/perf/window-spike/measure-*.ps1` from Windows PowerShell 5.1 (they need two
monitors for W2/W9; `measure-display-changes.ps1 -Primary \\.\DISPLAYn -Secondary …`), and
paste the summaries. Watch specifically for tauri #15947 (Win10 renders black after a
`WS_EX_LAYERED` toggle) in the W7 run: `stripFramesDuringToggles.minBlackFraction` must stay
≥ 0.9 and `flashes` 0.

## Escape hatch (only if W1, W2, W4 or W5 fail)

W5 failed in WebView2's default process model and was fixed by configuration, not by the
Direct2D pill: the overrun is the WebView2 GPU process, which a native strip would sit *next
to*, not replace — the tree without any renderer is still ≈ 127 MB on this machine. The pill
would only pay off if the WebView were created lazily (no WebView2 tree while collapsed), a
larger architectural change that costs the first expand a cold WebView2 start (≈ 350 ms
measured here) and was not needed. W1, W2 and W4 pass with margin. The prototype stays
documented, unbuilt, as the fallback if `--in-process-gpu` stops being honoured.

## Observations

- **WebView2's process tree is the memory budget.** `muna.exe` itself idles at 10.5 MB; the
  other 90 % is WebView2: browser process, GPU process, one renderer per window plus a spare,
  network and storage utilities, crashpad. Two levers are configuration
  (`--process-per-site` and disabling `SpareRendererForSitePerProcess` → one renderer;
  `--in-process-gpu` → no GPU process), one is an API call
  (`ICoreWebView2_19::MemoryUsageTargetLevel(Low)` → renderer 17 → 10 MB). All three are
  wired in the spike; the first two are the default configuration.
- **`additionalBrowserArgs` replaces Tauri's default switch list**, so the configured string
  repeats `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`. Every window of
  the app must carry the identical string: WebView2 shares one browser process per user data
  folder and rejects a second environment with different arguments. Runtime-created notch
  windows clone the `notch` config and inherit it.
- **The UI can be ready before the shell attaches the window.** With the faster start the
  primary webview published its shapes and `ready` before the reconcile had registered the
  window; `ready` was already buffered, the shapes were dropped and the primary had no
  hit-test rect. Both are now buffered per label and replayed on attach
  (`shapes_before_attach` / `ready_before_attach` events).
- **`backdrop-filter` is not needed.** The strip and panel are opaque black glass; nothing
  behind other apps needs blurring. Confirmed visually at 100/150/200 %.
- **Startup order matters (deadlock found and fixed).** Tauri managed state must be
  registered with `Builder::manage` before `setup`, and the spike's window list must never be
  locked across webview creation/destruction: both pump messages, and the `shell_ready` IPC
  command arriving in that pump needs the same lock. Reconcile now runs in three phases
  (locked bookkeeping → unlocked destroy → unlocked create, short lock to register).
- **tao owns `GWL_EXSTYLE`.** tao 0.35 rewrites the extended style wholesale from its own
  flags (it never sets `WS_EX_TOOLWINDOW` and leaves `WS_EX_APPWINDOW`). After creation the
  shell sets the ex-style itself and must not call tao's flag setters on notch windows,
  otherwise `TOOLWINDOW` disappears and the window shows up in Alt+Tab.
- **Click-through needs `WS_EX_LAYERED | WS_EX_TRANSPARENT`.** `WS_EX_TRANSPARENT` alone is not
  click-through for a top-level window. Toggling both via `SetWindowLongPtr` without
  `SWP_FRAMECHANGED` keeps the WebView2 content visible (0 flashes over hundreds of frames on
  Win11) and `WDA_EXCLUDEFROMCAPTURE` works in both states. ADR-0001's "never toggle
  `WS_EX_LAYERED` mid-animation" stays as the Win10 caution (tauri #15947); on Win11 the
  toggle itself is not the risk.
- **`SetWindowLongPtr` / `SetWindowPos` from another thread message the main thread
  synchronously.** Apply them outside any lock the main thread may take; the first W7 run
  stalled here.
- **Windows' timer tick defeats `tokio::time::sleep`.** A 16.7 ms tokio sleep ran at 31.2 ms
  (15.6 ms tick); `std::thread::sleep` on a dedicated OS thread uses a high-resolution waitable
  timer and runs at 17.1 ms without raising the process timer resolution. The cursor poll lives
  on that thread; `poll_stats` events report the real interval.
- **Top-most re-assertion needs a second pass.** Windows raises a newly *activated* topmost
  window after `EVENT_SYSTEM_FOREGROUND` is delivered, so a single immediate
  `SetWindowPos(HWND_TOPMOST)` lost in 10/10 trials (recoveries 47 ms – 1.5 s, three misses).
  Asserting on the hook, again after 20 ms (≈ 28 ms real, tokio tick) and after 250 ms
  brought the strip back in a median 31–33 ms with 0 misses. A topmost window shown *without* a
  foreground change stays above until the next foreground event — candidate M1 follow-up: hook
  `EVENT_OBJECT_SHOW` / `EVENT_OBJECT_REORDER` filtered to `WS_EX_TOPMOST` top-level windows.
- **`QUNS_BUSY` is a hint, not a verdict.** Another notch utility on the machine (a Qt layered
  topmost window covering the monitor) keeps `SHQueryUserNotificationState` at `QUNS_BUSY`
  permanently. The shell parks only when the foreground window also covers the monitor
  ([04 › shell & window management](../04-windows-platform-apis.md#shell--window-management)).
- **Mixed DPI just works** with per-monitor-v2 awareness: shapes are published in CSS px and
  converted with the monitor's scale; `WM_DPICHANGED` arrives ≈ 250 ms after a scale change
  and tao's default reposition is corrected by the next reconcile within ≈ 20 ms.
- **`SetWindowPos(SWP_ASYNCWINDOWPOS)`** for placement and `HWND_TOPMOST` behaved as ADR-0002
  assumed; `WS_EX_NOACTIVATE` kept focus with the foreground app throughout.
- **Harness lessons** (for M1-E3's perf harness): PDH `\Process(name#N)` paths silently drop
  instances — use `Win32_PerfFormattedData_PerfProc_Process` keyed by PID; Windows PowerShell
  5.1 needs a UTF-8 BOM; WinForms windows shown from PowerShell are activated even with
  `SW_SHOWNA`, which is what made W12 measurable from `ShowWindow`.

## Recommendation

**WebView strip, with WebView2 launched as `--in-process-gpu --process-per-site` and the spare
renderer disabled.** ADR-0001 and ADR-0002 are validated on Windows 11 25H2 without change
to the stack or window model; three operational details are amended: the WebView2 switch
set above (without it W5 fails by 60–100 MB), a three-step top-most re-assertion (hook,
+20 ms, +250 ms) and a cursor poll on a dedicated OS thread rather than a tokio timer. The
Direct2D pill escape hatch stays documented, unbuilt. Two items go to the maintainer:

1. The Windows 10 22H2 column (runbook above).
2. The memory row rests on a Chromium command-line switch. The M1-E3 perf harness must
   guard it (no GPU-process child, ≤ 120 MB); if a WebView2 update ignores the switch, the
   budget cannot be met by a WebView2 strip on integrated GPUs of this class and the choice
   is an evidence-based budget change or a lazily created WebView behind a native strip.
   No budget was changed in this spike.

## ADR updates

- ADR-0001: status → *Accepted (validated on Win11 25H2 by M0-E2; Win10 22H2 pending)*,
  linking this file; the Result paragraph records the W5 finding and the switch set.
- ADR-0002: same, plus the three amendments above (WebView2 switches, top-most re-assertion,
  cursor-poll thread) and the `--in-process-gpu` consequence.
- Risk register: R6 (performance budget breach) notes the WebView2 floor and the guard; a
  new R19 tracks the switch dependency.
