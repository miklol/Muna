//! Service traits. Methods are synchronous and cheap: implementations either answer from a
//! cache maintained by their own background threads or issue a non-blocking OS call. Anything
//! that must wait for the OS reports back through [`PlatformEvent`].

use tokio::sync::broadcast;

use crate::error::PlatformResult;
use crate::events::PlatformEvent;
use crate::types::{
    AudioDevice, AutostartMechanism, BatteryState, BluetoothDevice, BluetoothRadioState,
    BrightnessMonitor, ForegroundWindow, GeoPosition, MediaCommand, MediaSession, MonitorInfo,
    OsdState, Rect, SystemSample, Thumbnail, UserNotificationState, WindowHandle,
};

/// System Media Transport Controls (docs/modules/media.md). Snapshots come from a cache the
/// implementation keeps current from the OS's change events; every change republishes the
/// whole list as [`PlatformEvent::MediaSessionsChanged`].
pub trait Media: Send + Sync {
    /// All current sessions; the media module scores them to pick the active one.
    fn sessions(&self) -> PlatformResult<Vec<MediaSession>>;
    /// The session's current artwork, `None` while it has none. Compare
    /// [`MediaSession::art_version`] first to avoid copying bytes that did not change.
    fn thumbnail(&self, source_app_id: &str) -> PlatformResult<Option<Thumbnail>>;
    /// Queues a transport command; the outcome shows up as a later snapshot, not a return
    /// value. [`crate::PlatformError::NotFound`] when the session is gone.
    fn send(&self, source_app_id: &str, command: MediaCommand) -> PlatformResult<()>;
    /// Asks for a fresh session manager. The media module calls it when a session looks stale
    /// (playing, but its position stopped moving), on top of the implementation's own periodic
    /// re-request (docs/04-windows-platform-apis.md, "Staleness").
    fn refresh(&self) -> PlatformResult<()>;
}

/// Core Audio endpoints (docs/modules/hud.md). Volume and mute mirror the default render
/// device; the implementation re-binds when the default device changes and reports every
/// change — including Muna's own — as [`PlatformEvent::VolumeChanged`].
pub trait Audio: Send + Sync {
    fn devices(&self) -> PlatformResult<Vec<AudioDevice>>;
    /// Master volume of the default render device, 0–100.
    fn volume(&self) -> PlatformResult<u8>;
    fn set_volume(&self, percent: u8) -> PlatformResult<()>;
    fn muted(&self) -> PlatformResult<bool>;
    fn set_muted(&self, muted: bool) -> PlatformResult<()>;
    /// Mute state of the default capture device; `None` when there is none.
    fn mic_muted(&self) -> PlatformResult<Option<bool>>;
    fn set_mic_muted(&self, muted: bool) -> PlatformResult<()>;
    fn set_default_device(&self, id: &str) -> PlatformResult<()>;
}

/// Display brightness (docs/modules/hud.md "Brightness"): internal panels through WMI,
/// external monitors through DDC/CI when the capability probe allows it. Reads answer from a
/// cache; `set` is queued and the new level comes back as
/// [`PlatformEvent::BrightnessChanged`].
pub trait Brightness: Send + Sync {
    fn monitors(&self) -> PlatformResult<Vec<BrightnessMonitor>>;
    /// [`crate::PlatformError::NotFound`] when `id` is not a monitor from [`Self::monitors`].
    fn set(&self, id: &str, percent: u8) -> PlatformResult<()>;
}

/// The shell's own volume/brightness flyout (docs/modules/hud.md "Suppress native flyout",
/// undocumented and best effort). Suppression hides the flyout's content window and keeps it
/// hidden while the shell recreates it; turning it off restores it. Implementations must
/// arrange for the flyout to come back if the process dies (the watchdog).
pub trait SystemOsd: Send + Sync {
    fn set_suppressed(&self, suppressed: bool) -> PlatformResult<OsdState>;
    fn state(&self) -> OsdState;
}

/// `WinRT` Bluetooth (docs/modules/bluetooth.md). Connect and disconnect block for as long as
/// the radio takes to reach the device (seconds when it is out of range); callers run them off
/// the async threads.
pub trait Bluetooth: Send + Sync {
    fn devices(&self) -> PlatformResult<Vec<BluetoothDevice>>;
    /// Asks the radio to reach a paired device. `Ok` once the link is up; `Unsupported` when
    /// Windows offers no way to connect this device from an app (the device may still connect
    /// itself later), `NotFound` for an unknown id. The connection state arrives as a
    /// [`PlatformEvent::BluetoothChanged`](crate::PlatformEvent::BluetoothChanged).
    fn connect(&self, id: &str) -> PlatformResult<()>;
    /// Drops the link to a connected device without unpairing it; `Ok` when it was already
    /// disconnected.
    fn disconnect(&self, id: &str) -> PlatformResult<()>;
    /// Whether the Bluetooth radio is on.
    fn radio(&self) -> BluetoothRadioState;
    /// Turns the radio on or off; `AccessDenied` when Windows refuses, `Unsupported` without a
    /// radio.
    fn set_radio(&self, on: bool) -> PlatformResult<()>;
}

/// Battery and power source.
pub trait Power: Send + Sync {
    fn battery(&self) -> PlatformResult<BatteryState>;
}

/// Machine load for the system monitor (docs/modules/system-monitor.md). Pull-based on
/// purpose: the module owns the cadence (1 Hz while its panel shows, 10 s for the strip gauge,
/// nothing otherwise), so an implementation keeps no timer of its own — it refreshes its
/// counters when asked and reports the change since the previous call.
pub trait SystemStats: Send + Sync {
    /// One reading. `top_processes` is how many of the busiest processes to include; `0` skips
    /// the process walk, which costs more than everything else in the sample together.
    fn sample(&self, top_processes: usize) -> PlatformResult<SystemSample>;
}

/// The device's position for the weather module (docs/modules/weather.md), from
/// `Windows.Devices.Geolocation`. One fix per call and no tracking; the call blocks for the
/// access check and the fix (seconds), so callers run it off the async threads.
pub trait Location: Send + Sync {
    /// `AccessDenied` when the user or a policy keeps location from desktop apps,
    /// `Unsupported` when the machine has no location source, `Os` for anything else. The
    /// implementation never asks Windows twice on its own: a denial stands until the caller
    /// asks again.
    fn position(&self) -> PlatformResult<GeoPosition>;
}

/// Small secrets — a calendar's private feed address, later an OAuth refresh token — in the
/// user's Windows Credential Manager (`.github/copilot-instructions.md`: "secrets only in
/// Windows Credential Manager"). Keys are the module's own (`calendar:ics:<id>`); the
/// implementation namespaces them under the app so nothing else's entries are read or
/// touched. Values are short UTF-8 strings (the store caps a blob at 2.5 KB).
pub trait Secrets: Send + Sync {
    /// The value under `key`, or `None` when there is none.
    fn get(&self, key: &str) -> PlatformResult<Option<String>>;
    /// Writes or replaces the value under `key`.
    fn set(&self, key: &str, value: &str) -> PlatformResult<()>;
    /// Removes the value under `key`; removing a missing key is not an error.
    fn remove(&self, key: &str) -> PlatformResult<()>;
}

/// Display topology, needed for one notch window per monitor (ADR-0002).
pub trait Monitors: Send + Sync {
    fn all(&self) -> PlatformResult<Vec<MonitorInfo>>;
}

/// Foreground window tracking for the yield rules (docs/modules/notch-shell.md).
pub trait Foreground: Send + Sync {
    fn current(&self) -> PlatformResult<Option<ForegroundWindow>>;
}

/// Native affinities of the notch windows (ADR-0002). The windows themselves are created by
/// Tauri; these calls adjust what Tauri does not expose. Every method is cheap and may be
/// called from any thread: positioning uses `SWP_ASYNCWINDOWPOS` so a caller never blocks on
/// the window's owning thread.
pub trait Windowing: Send + Sync {
    /// Extended window style (`GWL_EXSTYLE`) so the shell can verify `WS_EX_TOOLWINDOW |
    /// WS_EX_NOACTIVATE | WS_EX_TOPMOST` after creation.
    fn extended_style(&self, window: WindowHandle) -> PlatformResult<u32>;
    /// Moves and resizes in one call without waiting for the owning thread
    /// (`SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE`). Physical pixels.
    fn move_async(&self, window: WindowHandle, rect: Rect) -> PlatformResult<()>;
    /// Re-asserts `HWND_TOPMOST` (after `EVENT_SYSTEM_FOREGROUND`, ADR-0002).
    fn assert_topmost(&self, window: WindowHandle) -> PlatformResult<()>;
    /// Sets `WS_EX_TOOLWINDOW` and clears `WS_EX_APPWINDOW` so the window stays out of
    /// Alt+Tab (tao's `skipTaskbar` only removes the taskbar button). Returns the resulting
    /// extended style.
    fn set_tool_window(&self, window: WindowHandle) -> PlatformResult<u32>;
    /// Toggles `WS_EX_LAYERED | WS_EX_TRANSPARENT` so pointer input passes to the window
    /// below. Replaces tao's `set_ignore_cursor_events`, which rewrites the whole extended
    /// style from its own flags and drops `WS_EX_TOOLWINDOW` (docs/spikes/m0-window.md).
    fn set_click_through(&self, window: WindowHandle, click_through: bool) -> PlatformResult<()>;
    /// `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on / `WDA_NONE` off.
    fn set_capture_exclusion(&self, window: WindowHandle, excluded: bool) -> PlatformResult<()>;
    /// Sets or clears `WS_EX_NOACTIVATE`. The notch never takes focus except while *Pinned*
    /// with a text field focused (docs/modules/notch-shell.md, "never steals focus").
    fn set_no_activate(&self, window: WindowHandle, no_activate: bool) -> PlatformResult<()>;
    /// Current outer rectangle in physical screen pixels.
    fn window_rect(&self, window: WindowHandle) -> PlatformResult<Rect>;
    /// Cursor position in physical screen pixels.
    fn cursor_position(&self) -> PlatformResult<(i32, i32)>;
    /// `true` while any mouse button is held, whichever window has focus (`GetAsyncKeyState`).
    /// The cursor poll uses it to notice a click outside the notch's shapes: the window is
    /// click-through there, so the UI never sees that click itself.
    fn pointer_button_down(&self) -> PlatformResult<bool>;
    /// Top-level window under a screen point (hit-testing verification); `0` when none.
    fn window_at(&self, x: i32, y: i32) -> PlatformResult<WindowHandle>;
    /// `SHQueryUserNotificationState`.
    fn user_notification_state(&self) -> PlatformResult<UserNotificationState>;
}

/// Reserved-strip mode (docs/modules/notch-shell.md, Placement): an `SHAppBarMessage` `AppBar`
/// on `ABE_TOP` so maximised windows start below the strip. One reservation per window; the
/// notch window itself is the `AppBar` handle, its rect is *not* moved by the OS.
pub trait AppBar: Send + Sync {
    /// Registers (or updates) a top-edge reservation of `height` physical pixels spanning
    /// `monitor`. Returns the rect the shell granted (`ABM_QUERYPOS` may nudge it below
    /// another `AppBar`).
    fn reserve_top(&self, window: WindowHandle, monitor: Rect, height: u32)
    -> PlatformResult<Rect>;
    /// Removes the reservation (`ABM_REMOVE`); a no-op for windows that never registered.
    fn release(&self, window: WindowHandle) -> PlatformResult<()>;
}

/// Launch at login (docs/04-windows-platform-apis.md): `StartupTask` when the process has
/// package identity, the `HKCU\…\Run` key otherwise. Calls may block briefly (`WinRT` async is
/// joined), so callers run them off the UI thread.
pub trait Autostart: Send + Sync {
    fn mechanism(&self) -> AutostartMechanism;
    fn is_enabled(&self) -> PlatformResult<bool>;
    /// Returns [`crate::PlatformError::AccessDenied`] when the user or a policy disabled the
    /// startup task in Windows settings; the setting stays off in that case.
    fn set_enabled(&self, enabled: bool) -> PlatformResult<()>;
}

/// The whole platform: every service plus the event stream.
pub trait Platform: Send + Sync {
    fn media(&self) -> &dyn Media;
    fn audio(&self) -> &dyn Audio;
    fn brightness(&self) -> &dyn Brightness;
    fn system_osd(&self) -> &dyn SystemOsd;
    fn bluetooth(&self) -> &dyn Bluetooth;
    fn power(&self) -> &dyn Power;
    fn system_stats(&self) -> &dyn SystemStats;
    fn location(&self) -> &dyn Location;
    fn secrets(&self) -> &dyn Secrets;
    fn monitors(&self) -> &dyn Monitors;
    fn foreground(&self) -> &dyn Foreground;
    fn windowing(&self) -> &dyn Windowing;
    fn app_bar(&self) -> &dyn AppBar;
    fn autostart(&self) -> &dyn Autostart;

    /// New receiver for platform events. Events published before the call are not replayed.
    fn subscribe(&self) -> broadcast::Receiver<PlatformEvent>;

    /// Human-readable implementation name for diagnostics (`"windows"`, `"fake"`).
    fn name(&self) -> &'static str;
}
