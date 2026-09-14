# 04 · Windows platform API map

Every OS touchpoint Muna needs, the API that provides it, its constraints, and the open-source
reference that proves it works. Platform code lives in the `muna-platform` crate
(`apps/desktop/src-tauri/crates/muna-platform/`): traits in `src/traits.rs`, Windows
implementations in `src/windows/` behind `cfg(windows)`; **undocumented** APIs live in
`src/windows/undocumented/` behind feature flags and must fail soft.

Research basis: verified primary sources (Microsoft Learn, GitHub issues) gathered 2026-09-14;
items marked *(undocumented)* or *(community)* are reverse-engineered or anecdotal.

## Legend

| Symbol | Meaning |
| -------- | --------- |
| 🪪 | Requires package identity (MSIX or external-location package) — see [ADR-0003](adr/0003-packaging-identity.md) |
| ⚠️ | Undocumented / reverse-engineered — isolate, feature-flag, watchdog |
| 🔁 | No change event exists — poll |

## Tauri caveats

Shell-level facts that shape every window decision (details in [ADR-0001](adr/0001-tech-stack.md)).

| Topic | Fact | Muna rule |
| ------- | ------ | ----------- |
| Transparent undecorated window | `shadow:true` adds 1 px white border + rounded corners on Win11 | `shadow:false`; paint our own shadow |
| First-frame flash | White flash on `show()` since WebView2 ≥ 144 (tauri #15490/#14831); fixed by `noRedirectionBitmap` only in Tauri 3.0.0-alpha (PR #15410) | Never hide/show; park at (−10000,−10000). Set `WEBVIEW2_DEFAULT_BACKGROUND_COLOR=00000000` env before WebView2 creation. Adopt `noRedirectionBitmap` when it reaches stable |
| Win10 black render | tauri #15947 — `DwmEnableBlurBehindWindow` hack races with `WS_EX_LAYERED` toggles | Don't touch `WS_EX_LAYERED`/`WS_EX_TRANSPARENT` at runtime; use `set_ignore_cursor_events` only |
| Click-through + hover | No `forward` option (tauri #6164) | Rust `GetCursorPos` poll hit-testing (ADR-0002) |
| Drag & drop | `dragDropEnabled:true` (native OLE `IDropTarget`, gives real paths) disables HTML5 DnD on Windows | Native OLE for inbound files; pointer-event reordering in UI |
| Background blur | `backdrop-filter` can't blur other apps (tauri #15512/#10064) | Opaque black material; optional Composition host-backdrop companion HWND (P3) |
| `backgroundColor` alpha | Ignored for the window layer on Windows | Transparent via `transparent:true` only |
| MSIX | No bundler (tauri #4818) | `MakeAppx` script in CI |
| DPI | tao runs Per-Monitor V2; `WM_DPICHANGED` handled | Re-layout on `scaleFactorChanged` |

## Shell & window management

| Need | API | Notes |
| ------ | ----- | ------- |
| Overlay window styles | `SetWindowLongPtrW(GWL_EXSTYLE, WS_EX_TOOLWINDOW \| WS_EX_NOACTIVATE)` | Hide from Alt-Tab, never steal focus. Clear `NOACTIVATE` only in Pinned state with a text field |
| Always on top | `SetWindowPos(HWND_TOPMOST)` re-asserted after `EVENT_SYSTEM_FOREGROUND` | eIsland uses Electron `screen-saver` level for the same reason |
| Pre-size before paint | `SetWindowPos(SWP_ASYNCWINDOWPOS \| SWP_NOZORDER)` at startup | Avoids visible resize (onlytrisdev pattern) |
| Monitors | `EnumDisplayMonitors` + `GetMonitorInfoW` → `rcMonitor` (place notch) vs `rcWork` (AppBars/taskbar excluded); `WM_DISPLAYCHANGE` | One notch window per monitor; Tauri `available_monitors()` gives the same data |
| Reserved-strip mode | `SHAppBarMessage(ABM_NEW / ABM_QUERYPOS / ABM_SETPOS, ABE_TOP)` | Per monitor. Shrinks `rcWork`; maximized windows respect it |
| Foreground / move-size | `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MOVESIZESTART/END, EVENT_SYSTEM_MINIMIZESTART)` out-of-context | Drives yield rules in [notch-shell](modules/notch-shell.md) |
| Caption overlap check | `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` on foreground HWND | Compare against strip rect |
| Fullscreen detection 🔁 | `SHQueryUserNotificationState` → `QUNS_RUNNING_D3D_FULL_SCREEN`, `QUNS_BUSY`, `QUNS_PRESENTATION_MODE`; **or** PILLAR heuristic on the foreground HWND: `GetWindowRect` covers ≥ 90 % of `rcMonitor` **and** (`GetWindowLongPtr(GWL_STYLE)` has `WS_POPUP` or lacks `WS_CAPTION`) — catches borderless video/game fullscreen while a maximised browser (which keeps `WS_CAPTION`) only triggers *Peek* | Poll 500 ms while any window is foreground on that monitor; debounce park/unpark 500 ms. Exclusive-fullscreen games cannot be overlaid by anyone — document it |
| Cursor sampling | `GetCursorPos` 60 Hz inside window bounds, 10 Hz outside | Do **not** use `WH_MOUSE_LL` (hook removed silently if callback exceeds `LowLevelHooksTimeout`) |
| Hide from capture | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` (Win10 2004+) | Setting toggle; per top-level window |
| Session events | `WTSRegisterSessionNotification` (`WM_WTSSESSION_CHANGE` lock/unlock), `WM_POWERBROADCAST` | Lock live activity, suspend polling while locked |
| Single instance / tray / autostart | `tauri-plugin-single-instance`, `tray-icon`, `tauri-plugin-autostart` (`HKCU\…\Run`) or 🪪 `StartupTask.RequestEnableAsync` | `platform::autostart` abstracts both |
| Global hotkeys | `RegisterHotKey` (`MOD_NOREPEAT`) via `tauri-plugin-global-shortcut` | Conflicts reported in Settings |
| Identity check | `GetCurrentPackageFullName` → `APPMODEL_ERROR_NO_PACKAGE` | Feature-flags 🪪 modules at runtime |

## Media

| Need | API | Notes |
| ------ | ----- | ------- |
| Now playing | `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager` (1809+): `RequestAsync`, `GetSessions`, `CurrentSessionChanged`, `SessionsChanged`; per session `TryGetMediaPropertiesAsync` (title/artist/album/`Thumbnail`), `GetTimelineProperties`, `GetPlaybackInfo`, `TryPlay/Pause/SkipNext/Previous`, `TryChangeShuffle/AutoRepeatMode` | `windows` feature `Media_Control` + `Storage_Streams`. Capability `globalMediaControl` listed for packaged apps; unpackaged apps call it freely |
| Staleness | Manager instances go stale (cppwinrt #1310); autoplay state stale (eIsland #41) | Re-`RequestAsync()` every 60 s and on `SessionsChanged`; **score sessions** (playing > paused > last-changed) and verify with WASAPI peak meters (`IAudioMeterInformation`) per session app |
| Timeline | Spotify/browsers publish coarse positions 🔁 | 1 s tick interpolated in UI while `Playing` |
| Visualizer | WASAPI loopback (`cpal` loopback or `IAudioClient` `AUDCLNT_STREAMFLAGS_LOOPBACK`) + `realfft` in a Rust thread; 16–24 bands at 30 Hz | Off when not visible; NetSpeed-Dynamic reference |
| Volume | `IAudioEndpointVolume` (`GetMasterVolumeLevelScalar`, `SetMasterVolumeLevelScalar`, `SetMute`) + `IAudioEndpointVolumeCallback::OnNotify`; devices via `IMMDeviceEnumerator` + `IMMNotificationClient` | Drives the HUD without polling |
| Output device switch ⚠️ | `IPolicyConfig` CLSID `870af99c-171d-4f9e-af0d-e63df40c2bc9` `SetDefaultEndpoint(id, eRole)` | Misbehaves under MSIX → helper process (ADR-0003). EarTrumpet / Seelen-UI ports |
| Lyrics | LRCLIB `GET /api/get?track_name&artist_name&album_name&duration` (no auth) | Cache in SQLite; optional |
| Album art palette | Thumbnail stream → Rust `color-thief`/k-means 3 colours → CSS vars | Cache by (title, artist, album) |

## HUD (volume, brightness, keyboard)

| Need | API | Notes |
| ------ | ----- | ------- |
| Volume keys | Mirror via `IAudioEndpointVolumeCallback` (no key hook needed) | Muna shows HUD on any level change, including mouse/tray |
| Brightness (internal) | WMI `root\wmi` `WmiMonitorBrightness` (read) / `WmiMonitorBrightnessMethods.WmiSetBrightness(timeout, pct)`; `WmiMonitorBrightnessEvent` for changes | `wmi` crate |
| Brightness (external) | DDC/CI `GetPhysicalMonitorsFromHMONITOR` → `GetVCPFeatureAndVCPFeatureReply(0x10)` / `SetVCPFeature(0x10)` (`dxva2.dll`) | ~50 ms/call; many monitors non-compliant → per-monitor capability probe, opt-in |
| Hide native flyout ⚠️ | Build ≥ 22620: outer `XamlExplorerHostIslandWindow` ⊃ `Windows.UI.Composition.DesktopWindowContentBridge` titled `DesktopWindowXamlSource`; older: `NativeHWNDHost` ⊃ `DirectUIHWND`. Must belong to `explorer.exe` **and** `GetWindowBand(hwnd) == ZBID_ABOVELOCK_UX` (undocumented user32 export). Then `ShowWindowAsync(inner, SW_MINIMIZE)`; re-apply on `SetWinEventHook(EVENT_OBJECT_CREATE…STATECHANGE, explorerPid)` with 3 s rehook timer | ModernFlyouts `NativeFlyoutHandler.cs`; HideVolumeOSD. Best-effort: on 26200 no flyout exists for mouse changes. **Watchdog restores on exit/crash** |
| Keyboard backlight | No public API; vendor-specific | Out of scope |

## Notifications & focus

| Need | API | Notes |
| ------ | ----- | ------- |
| Listen 🪪 | `Windows.UI.Notifications.Management.UserNotificationListener.Current`: `RequestAccessAsync`, `GetNotificationsAsync(NotificationKinds.Toast)`, `NotificationChanged`, `RemoveNotification`, `ClearNotifications`; text via `Notification.Visual.GetBinding(KnownNotificationBindings.ToastGeneric).GetTextElements()`; `AppInfo.DisplayInfo` for name/logo | Capability `userNotificationListener`. **Unpackaged:** `RequestAccessAsync`/`GetNotificationsAsync` work, `NotificationChanged` throws `0x80070490` (WindowsAppSDK #6172) → 1 s polling fallback (Seelen-UI, NetSpeed-Dynamic) |
| Focus Assist state | Win11 23H2+: `Windows.UI.Shell.FocusSessionManager.GetDefault()` → `IsFocusActive`, `IsFocusActiveChanged` (`IsSupported` check) | Toggle needs a Limited Access Feature token → deep-link `ms-settings:quiethours` instead |
| Focus Assist (Win10) ⚠️ | WNF `WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED` via `NtQueryWnfStateData` | Read-only, optional |
| Muna's own toasts | `tauri-plugin-notification` / `ToastNotificationManager` (🪪 for reliable AUMID) | Only for errors that can't be shown in the notch |

## Calendar, reminders, to-do

| Need | API | Notes |
| ------ | ----- | ------- |
| Microsoft 365 / Outlook.com | Microsoft Graph `GET /me/calendarView?startDateTime&endDateTime` (+ `Prefer: outlook.timezone`), `/me/events` for create; MSAL **PKCE loopback** or device-code flow | Delegated `Calendars.ReadWrite`, `offline_access`. Tokens in Credential Manager |
| Google | Calendar API v3 `events.list(singleEvents, orderBy=startTime)`, `events.insert`; OAuth loopback PKCE | Needs Google Cloud project + verification for public release |
| ICS subscriptions | HTTPS fetch + `ical` crate parse, RRULE expansion (`rrule` crate) | Zero-auth path; refresh 15 min |
| Windows Calendar store 🪪 | `AppointmentManager.RequestStoreAsync(AllCalendarsReadOnly)` — capability `appointmentsSystem`; sees only Mail/Calendar-synced accounts | Opportunistic bonus when packaged |
| Meeting links | Regex on location/body for Teams/Zoom/Meet/Webex URLs | `ShellExecuteW` open |
| Tasks | Local SQLite; optional Microsoft To Do (Graph `/me/todo/lists`) and Google Tasks | Local first |

## Devices & power

| Need | API | Notes |
| ------ | ----- | ------- |
| Battery state | `Windows.System.Power.PowerManager`: `BatteryStatus`, `PowerSupplyStatus`, `RemainingChargePercent`, `RemainingDischargeTime`, `EnergySaverStatus` + `*Changed` events | "Charging" live activity on `PowerSupplyStatusChanged → Adequate`. `Battery.AggregateBattery.GetReport()` for mWh rates |
| Bluetooth enumerate | `DeviceInformation.CreateWatcher(BluetoothDevice.GetDeviceSelectorFromPairingState(true), [System.Devices.Aep.IsConnected, …], AssociationEndpoint)`; LE via `BluetoothLEDevice.GetDeviceSelectorFromPairingState`; `BluetoothDevice.ConnectionStatusChanged` | Capability `bluetooth` (declared in MSIX). Seelen-UI `radios/bluetooth/classic.rs` |
| Bluetooth battery (LE) | GATT Battery Service `0x180F` / characteristic `0x2A19`, subscribe notifications | Standard |
| Bluetooth battery (classic/HFP) ⚠️ | PnP property `{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2` on the `BTHENUM` node via `SetupDiGetDevicePropertyW` | Undocumented; AirPods report one combined %, often stale (cembaylam/peripheral-battery) |
| Bluetooth connect/disconnect ⚠️ | `BluetoothSetServiceState(hRadio, &info, &A2DP_SINK / HFP, DISABLE→ENABLE)`; disconnect `DeviceIoControl(IOCTL_BTH_DISCONNECT_DEVICE 0x0041000C)` | Disabled state is **persistent** → journal and re-enable on start/`Drop` |
| Radio power | `Windows.Devices.Radios.Radio.GetRadiosAsync()` → `SetStateAsync` (capability `radios`) | Consent prompt first time |
| USB eject | `CM_Request_Device_EjectW` on the volume's devnode; `IOCTL_STORAGE_EJECT_MEDIA` fallback | Drop-action tile |
| Webcam (Mirror) | WebView2 `getUserMedia` (needs `webcam` capability under MSIX + Windows privacy toggle) | Zero Rust; stop tracks on collapse |

## System stats

| Need | API | Notes |
| ------ | ----- | ------- |
| CPU / RAM / disk / net | `sysinfo` crate or PDH counters, `GlobalMemoryStatusEx` | 1 Hz visible, 10 s otherwise |
| GPU | `nvml-wrapper` (NVIDIA); PDH `\GPU Engine(*)\Utilization Percentage` fallback for AMD/Intel | Best effort |
| Temperatures | Kernel-driver territory (LibreHardwareMonitor) — never in main process | Optional elevated sidecar, P3 |
| Per-app usage (Screen time) | `EVENT_SYSTEM_FOREGROUND` hook + `GetWindowThreadProcessId` + `QueryFullProcessImageNameW`; idle via `GetLastInputInfo` | Local SQLite; no telemetry |

## Files, clipboard, sharing, capture

| Need | API | Notes |
| ------ | ----- | ------- |
| Inbound drop | Tauri `onDragDropEvent` (native OLE `IDropTarget`, `CF_HDROP`) | Enter/over/drop/leave with screen coords |
| Outbound drag (Shelf) | `tauri-plugin-drag` / `drag::start_drag(DragItem::Files, preview)` → `DoDragDrop` | Drag files out to Explorer, browsers, Teams |
| File ops | `IFileOperation` (copy/move with shell progress, undo) via `windows` crate; `SHOpenFolderAndSelectItems`; recycle via `FOF_ALLOWUNDO` | Never `std::fs::remove_file` for user files |
| Nearby Share | `IDataTransferManagerInterop::GetForWindow(hwnd)` → `DataTransferManager.DataRequested` → `ShowShareUIForWindow` | Works from desktop apps (community); DynamicWin uses it |
| Compress | `zip` crate (store/deflate) with progress | Drop-action tile |
| Clipboard history | `Windows.ApplicationModel.DataTransfer.Clipboard.HistoryChanged` (1809+, `IsHistoryEnabled`) | Shelf "recent copies" (P2) |
| Screenshot | `Windows.Graphics.Capture` via `windows-capture` crate (`GraphicsCaptureItem.CreateForMonitor`), `GraphicsCapturePicker` for region | Yellow border drawn by OS; exclude Muna via `WDA_EXCLUDEFROMCAPTURE` |
| Open with / reveal | `ShellExecuteExW(SEE_MASK_INVOKEIDLIST, "openas")`, `SHOpenFolderAndSelectItems` | Drop tiles |

## Window snap

| Need | API | Notes |
| ------ | ----- | ------- |
| Move/resize | `SetWindowPos` with `DWMWA_EXTENDED_FRAME_BOUNDS` offset compensation; `ShowWindow(SW_RESTORE)` first if maximized | Account for invisible resize borders |
| Drag tracking | `EVENT_SYSTEM_MOVESIZESTART/END` + `GetCursorPos` | Snap zones appear only while dragging |
| Eligible windows | `IsWindowVisible`, no `WS_EX_TOOLWINDOW`, not cloaked (`DWMWA_CLOAKED`), has caption or `WS_THICKFRAME` | Skip UWP frame hosts unless `ApplicationFrameWindow` with content |
| Virtual desktops | Undocumented `IVirtualDesktopManager` beyond `IsWindowOnCurrentVirtualDesktop` ⚠️ | Only the public `IsWindowOnCurrentVirtualDesktop` |

## Code hosting & AI coding

| Need | API | Notes |
| ------ | ----- | ------- |
| GitHub | REST/GraphQL with **device flow** OAuth (`client_id` public); notifications `GET /notifications`, PRs `search/issues`, checks `GET /repos/{o}/{r}/commits/{sha}/check-runs`; ETag + `X-Poll-Interval` | Token in Credential Manager |
| GitLab | REST v4 PAT or OAuth PKCE; `/merge_requests?scope=assigned_to_me`, `/todos` | Self-hosted URL supported |
| Claude Code / Codex / Copilot CLI status | Watch local session files (`%USERPROFILE%\.claude\projects\**\*.jsonl`), terminal titles via `EVENT_OBJECT_NAMECHANGE` on console/WT windows, optional local HTTP webhook (`127.0.0.1:port`) posted by hooks | Best effort; per-tool adapter |

## Packaging, update, signing

| Need | API / tool | Notes |
| ------ | ------------ | ------- |
| MSIX | `MakeAppx pack /nv` + `AppxManifest.xml` + `signtool sign /fd SHA256` | Publisher == cert subject; CI script |
| External-location identity (NSIS) | `Add-AppxPackage -ExternalLocation` with `uap10:AllowExternalContent="true"` manifest | Post-install step in NSIS hook |
| Updater | `tauri-plugin-updater` (minisign `TAURI_SIGNING_PRIVATE_KEY`, static `latest.json`) for NSIS; App Installer / Store for MSIX | Separate channels |
| Signing | Azure Artifact Signing (Basic ≈ $9.99/mo) or SignPath Foundation (OSS) | Verify eligibility in M0 |
| WebView2 | `downloadBootstrapper` in `tauri.conf.json`; Evergreen runtime present on Win10 22H2+/Win11 | Offline installer option documented |

## Crates & packages

`tauri` 2.x, `tauri-plugin-{single-instance,autostart,global-shortcut,clipboard-manager,positioner,updater,notification}`,
`tauri-plugin-drag`, `windows` ≥ 0.62 (features: `Media_Control`, `Storage_Streams`,
`UI_Notifications_Management`, `UI_Shell`, `Devices_Bluetooth`, `Devices_Enumeration`,
`Devices_Radios`, `System_Power`, `ApplicationModel_DataTransfer`, `Win32_Media_Audio_Endpoints`,
`Win32_Devices_Bluetooth`, `Win32_UI_WindowsAndMessaging`, `Win32_UI_Shell`, `Win32_Graphics_Gdi`,
`Win32_Graphics_Dwm`, `Win32_UI_Accessibility`, `Win32_System_RemoteDesktop`), `sysinfo`,
`nvml-wrapper`, `wmi`, `windows-capture`, `cpal` + `realfft`, `rusqlite`, `tokio`, `serde`,
`specta`/`tauri-specta`, `keyring` (Credential Manager), `ical`, `rrule`, `zip`, `color-thief`.

## Repositories to study (not copy)

| Repo | Why |
| ------ | ----- |
| [eythaann/Seelen-UI](https://github.com/eythaann/Seelen-UI) (AGPL) | `AppxManifest.xml`, MSIX script, notifications polling fallback, BT classic connect, `IPolicyConfig` port, `FocusSessionManager` |
| [WinIslandProject/WinIsland](https://github.com/WinIslandProject/WinIsland) | Overlay styles, host-backdrop blur companion HWND, working-set trimming |
| [GEORGEWWWU/NetSpeed-Dynamic](https://github.com/GEORGEWWWU/NetSpeed-Dynamic) | Tauri 2 island: SMTC + notification polling in `windows` crate, `cpal`+`realfft` spectrum, fullscreen auto-hide |
| [FunplayAI/EchoIsland](https://github.com/FunplayAI/EchoIsland) | Native D2D pill fallback for a Tauri app |
| [onlytrisdev/dynamic-island-windows](https://github.com/onlytrisdev/dynamic-island-windows) | Tauri + Framer Motion: pre-size trick, SMTC session scoring + WASAPI verification |
| [JNTMTMTM/eIsland](https://github.com/JNTMTMTM/eIsland) | Electron reference; what to avoid (runtime weight) |
| [ModernFlyouts-Community/ModernFlyouts](https://github.com/ModernFlyouts-Community/ModernFlyouts) | `NativeFlyoutHandler.cs` OSD suppression, z-band handling |
| [File-New-Project/EarTrumpet](https://github.com/File-New-Project/EarTrumpet) | Production Core Audio + `IPolicyConfig`, MSIX/Store |
| [FlorianButz/DynamicWin](https://github.com/FlorianButz/DynamicWin) | UX reference (binaries only) |
| [warpirate/pillar-dynamic-island-for-windows](https://github.com/warpirate/pillar-dynamic-island-for-windows) | Windows island: fullscreen heuristic (≥ 90 % rect + `WS_POPUP`/no `WS_CAPTION`), spring presets, slide-away park |
| [devcode90/Dynamic-Island-for-Windows](https://github.com/devcode90/Dynamic-Island-for-Windows) | Windows pill proportions and top-offset placement |
| [TheBoredTeam/boring.notch](https://github.com/TheBoredTeam/boring.notch) (macOS) | Notch SVG path with outward top fillets, open/close/interactive springs, hover intent & grace timings, sneak-peek |
| [Lakr233/NotchDrop](https://github.com/Lakr233/NotchDrop) (macOS) | Shelf interaction design, drop animation |
| [MrKai77/DynamicNotchKit](https://github.com/MrKai77/DynamicNotchKit) (macOS) | Content blur/scale enter transition, `.smooth` collapse |
| [arihantcodes/spectrum-ui](https://github.com/arihantcodes/spectrum-ui) | React + Motion Dynamic Island component (size-morph + `AnimatePresence` pattern) |
| [UselessToys/Ecosystem_WebUI](https://github.com/UselessToys/Ecosystem_WebUI) | Web island toast spring physics (measured for `notice`/`content` presets) |
| [phamfoo/figma-squircle](https://github.com/phamfoo/figma-squircle) | `clip-path` squircle fallback algorithm |
| [cembaylam/peripheral-battery](https://github.com/cembaylam/peripheral-battery) | BT battery DEVPKEY reader |
| [crabnebula-dev/drag-rs](https://github.com/crabnebula-dev/drag-rs) | Out-of-app file drag |
| [UnlimitedStack/HideVolumeOSD](https://github.com/UnlimitedStack/HideVolumeOSD) | Minimal OSD hide |

## Known unknowns (re-verify in M0)

- Whether Tauri 2.12 stable backports `noRedirectionBitmap`, or v3 is the only path.
- Exact capability name for `AppointmentStore` system access (`appointmentsSystem` per API page).
- Flyout window classes on future Windows builds; `GetWindowBand` availability.
- `IDataTransferManagerInterop` from an unpackaged desktop process (community-confirmed only).
- AMD/Intel GPU utilisation without vendor SDKs.
