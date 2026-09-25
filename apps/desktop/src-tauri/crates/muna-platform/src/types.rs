//! Plain data types shared by the traits, the fake and the real implementation.
//!
//! Everything here is `serde`/`specta`-derived so module backends can forward snapshots to the
//! UI without re-mapping.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Integer rectangle in physical (device) pixels, screen coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    #[must_use]
    pub const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// `true` when the point lies inside the rectangle (edges inclusive on the near side).
    #[must_use]
    pub fn contains(&self, px: i32, py: i32) -> bool {
        let right = self.x.saturating_add_unsigned(self.width);
        let bottom = self.y.saturating_add_unsigned(self.height);
        px >= self.x && px < right && py >= self.y && py < bottom
    }
}

/// One attached display, as reported by `EnumDisplayMonitors` / `GetDpiForMonitor`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Stable per-session id (device name on Windows, e.g. `\\.\DISPLAY1`).
    pub id: String,
    pub bounds: Rect,
    pub work_area: Rect,
    /// Effective DPI; 96 = 100 %.
    pub dpi: u32,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Playing,
    Paused,
    Stopped,
}

/// `MediaPlaybackAutoRepeatMode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RepeatMode {
    None,
    Track,
    List,
}

/// Which transport operations the session's app currently accepts
/// (`GlobalSystemMediaTransportControlsSessionPlaybackControls`). The UI hides or disables a
/// control the app refuses instead of faking it (docs/modules/media.md, "no fake seek").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
// A flag set mirroring the OS type; a bitfield would only obscure the JSON shape.
#[allow(clippy::struct_excessive_bools)]
pub struct MediaControls {
    pub play: bool,
    pub pause: bool,
    pub next: bool,
    pub previous: bool,
    pub seek: bool,
    pub shuffle: bool,
    pub repeat: bool,
}

impl MediaControls {
    /// Everything allowed; what a well-behaved player advertises.
    pub const ALL: Self = Self {
        play: true,
        pause: true,
        next: true,
        previous: true,
        seek: true,
        shuffle: true,
        repeat: true,
    };
}

/// A System Media Transport Controls session, normalised.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    /// Source `AppUserModelId` (e.g. `Spotify.exe`).
    pub source_app_id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub status: PlaybackStatus,
    /// Position as of this snapshot. The implementation advances the app's last reported
    /// position by its age while `Playing`, so consumers interpolate from the moment the
    /// snapshot arrives (docs/04-windows-platform-apis.md, "Timeline").
    // `u32` (≈ 49 days) rather than `u64`: the TypeScript exporter refuses 64-bit integers.
    pub position_ms: Option<u32>,
    pub duration_ms: Option<u32>,
    /// `None` when the app does not report shuffle.
    pub shuffle: Option<bool>,
    /// `None` when the app does not report a repeat mode.
    pub repeat: Option<RepeatMode>,
    pub controls: MediaControls,
    /// `true` for the session the OS itself calls current (`GetCurrentSession`).
    pub is_current: bool,
    /// Increments each time the session's artwork bytes change; `0` while it has none. Lets a
    /// consumer fetch [`crate::Media::thumbnail`] only when something new arrived (Spotify
    /// delivers art 300–1000 ms after the track change).
    pub art_version: u32,
}

impl MediaSession {
    /// A minimal session with the given app and title, everything else at rest. Handy in
    /// tests and for scripting the fake.
    #[must_use]
    pub fn new(source_app_id: &str, title: &str) -> Self {
        Self {
            source_app_id: source_app_id.into(),
            title: title.into(),
            artist: String::new(),
            album: None,
            status: PlaybackStatus::Stopped,
            position_ms: None,
            duration_ms: None,
            shuffle: None,
            repeat: None,
            controls: MediaControls::default(),
            is_current: false,
            art_version: 0,
        }
    }
}

/// Encoded artwork exactly as the app handed it to the OS (PNG or JPEG in practice).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Thumbnail {
    pub bytes: Vec<u8>,
    /// MIME type from the stream (`image/jpeg`, `image/png`); empty when unknown.
    pub content_type: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MediaCommand {
    Play,
    Pause,
    TogglePlayPause,
    Next,
    Previous,
    SetShuffle {
        enabled: bool,
    },
    SetRepeat {
        mode: RepeatMode,
    },
    /// `TryChangePlaybackPositionAsync`; refused by the implementation when the session does
    /// not advertise seeking.
    Seek {
        position_ms: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// How a display's backlight is driven (docs/modules/hud.md "Brightness").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum BrightnessKind {
    /// A laptop panel through WMI (`WmiMonitorBrightness`); changes arrive as events.
    Internal,
    /// An external monitor through DDC/CI (`dxva2`); ~50 ms per call and best effort, so the
    /// HUD only offers it once the capability probe said yes.
    External,
}

/// A display whose brightness Muna can read and set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BrightnessMonitor {
    /// Stable for the session: the WMI instance name for a panel, the GDI device name plus
    /// the physical index (`\\.\DISPLAY1#0`) for DDC/CI.
    pub id: String,
    /// What the monitor calls itself (`szPhysicalMonitorDescription`), or the panel's name.
    pub name: String,
    /// 0–100, normalised from the monitor's own range.
    pub percent: u8,
    pub kind: BrightnessKind,
}

/// Whether the shell's own volume/brightness flyout is showing or hidden by Muna
/// (docs/modules/hud.md "Suppress native flyout").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum OsdState {
    /// Windows draws its flyout as usual.
    Native,
    /// Muna hid the flyout's content window; the watchdog restores it if Muna dies.
    Suppressed,
    /// No flyout window exists on this build or it failed the ownership checks; nothing is
    /// suppressed and nothing breaks.
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothDevice {
    pub id: String,
    pub name: String,
    pub connected: bool,
    /// 0–100 when the device reports it.
    pub battery_percent: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PowerSource {
    Battery,
    Ac,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BatteryState {
    /// `None` when the machine has no battery.
    pub percent: Option<u8>,
    pub source: PowerSource,
    pub charging: bool,
}

/// One reading of the machine's load (docs/modules/system-monitor.md). Counters are raw:
/// the module derives rates and percentages from consecutive samples with its own clock.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSample {
    /// Whole-machine CPU use since the previous sample, 0–100 across every logical processor.
    /// `None` for the first sample after the sampler started: there is no previous reading.
    pub cpu_percent: Option<f32>,
    pub logical_cpus: u16,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    /// Every mounted volume; the module picks the system volume and sums the fixed ones.
    pub disks: Vec<DiskSpace>,
    /// Bytes received over every interface since boot; wraps are the caller's problem.
    pub network_received_bytes: u64,
    /// Bytes sent over every interface since boot.
    pub network_transmitted_bytes: u64,
    /// The busiest processes, most CPU first, at most as many as were asked for. Empty when
    /// the caller asked for none — the process walk is the expensive part of a sample.
    pub processes: Vec<ProcessUsage>,
}

/// Capacity of one volume.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpace {
    /// Volume label, or the mount when it has none.
    pub name: String,
    /// `C:\` on Windows.
    pub mount: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    /// USB sticks and cards; not part of the machine's storage.
    pub removable: bool,
    /// The volume Windows booted from.
    pub system: bool,
}

/// One process, or every process sharing an executable name, in a sample. The module maps it
/// to its wire type; the raw sample never crosses the IPC boundary.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessUsage {
    /// Executable name without the extension ("chrome"); never a window title or path.
    pub name: String,
    /// Share of the whole machine since the previous sample, 0–100.
    pub cpu_percent: f32,
    /// Working set summed over the group (what Task Manager's "Memory" column counts is the
    /// private working set, so this reads a little higher).
    pub memory_bytes: u64,
    /// How many processes the row aggregates.
    pub count: u16,
}

/// The foreground window, enough to decide whether the notch must yield.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindow {
    /// Native handle, so the shell can tell its own windows apart from everything else. Never
    /// crosses the IPC boundary.
    #[serde(skip)]
    #[specta(skip)]
    pub handle: WindowHandle,
    pub title: String,
    pub process_name: String,
    pub bounds: Rect,
    pub is_fullscreen: bool,
}

/// A native top-level window handle (`HWND`) as an integer, so the shell crate never depends
/// on the `windows` crate. `0` is "no window".
pub type WindowHandle = isize;

/// How launch-at-login is persisted on this platform (docs/04-windows-platform-apis.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AutostartMechanism {
    /// `Windows.ApplicationModel.StartupTask`; only available with package identity.
    StartupTask,
    /// `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
    RunKey,
    /// The fake platform, or a build without either mechanism.
    None,
}

/// `SHQueryUserNotificationState`, the shell's own idea of whether the user may be
/// interrupted (docs/modules/notch-shell.md, yield rules).
///
/// Advisory only: the shell treats `QUNS_BUSY` as a *hint* and confirms it against the
/// foreground window, because any full-monitor layered overlay (other notch utilities do
/// this) makes the API report `Busy` permanently (docs/spikes/m0-window.md, W6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum UserNotificationState {
    /// Screen saver, locked, or switched away (`QUNS_NOT_PRESENT`).
    NotPresent,
    /// A fullscreen application or presentation settings are active (`QUNS_BUSY`).
    Busy,
    /// An exclusive Direct3D fullscreen app is running (`QUNS_RUNNING_D3D_FULL_SCREEN`).
    FullscreenD3d,
    /// Presentation mode (`QUNS_PRESENTATION_MODE`).
    Presentation,
    /// Nothing special (`QUNS_ACCEPTS_NOTIFICATIONS`).
    AcceptsNotifications,
    /// Focus assist / quiet hours (`QUNS_QUIET_TIME`).
    QuietTime,
    /// A Windows Store app is in the foreground (`QUNS_APP`).
    App,
}

impl UserNotificationState {
    /// `true` when the shell reports something that *may* require the notch to park
    /// (a fullscreen app or presentation settings). Confirm with
    /// [`Self::requires_fullscreen_confirmation`] before acting.
    #[must_use]
    pub const fn suppresses_overlay(self) -> bool {
        matches!(self, Self::Busy | Self::FullscreenD3d | Self::Presentation)
    }

    /// `true` when the state alone is not trustworthy and the foreground window must also be
    /// fullscreen before the notch parks. Presentation mode has no window to check.
    #[must_use]
    pub const fn requires_fullscreen_confirmation(self) -> bool {
        matches!(self, Self::Busy | Self::FullscreenD3d)
    }

    /// Decides whether the notch should park given this state and whether the foreground
    /// window is fullscreen (`None` when unknown).
    #[must_use]
    pub const fn should_park(self, foreground_fullscreen: Option<bool>) -> bool {
        if !self.suppresses_overlay() {
            return false;
        }
        if self.requires_fullscreen_confirmation() {
            return matches!(foreground_fullscreen, Some(true));
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::UserNotificationState as S;

    #[test]
    fn busy_parks_only_with_a_fullscreen_foreground_window() {
        assert!(S::Busy.should_park(Some(true)));
        assert!(!S::Busy.should_park(Some(false)));
        assert!(!S::Busy.should_park(None));
        assert!(S::FullscreenD3d.should_park(Some(true)));
        assert!(!S::FullscreenD3d.should_park(Some(false)));
    }

    #[test]
    fn presentation_parks_unconditionally() {
        assert!(S::Presentation.should_park(None));
        assert!(S::Presentation.should_park(Some(false)));
    }

    #[test]
    fn benign_states_never_park() {
        for state in [S::NotPresent, S::AcceptsNotifications, S::QuietTime, S::App] {
            assert!(!state.should_park(Some(true)), "{state:?}");
        }
    }
}
