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
    // `u32` (≈ 49 days) rather than `u64`: the TypeScript exporter refuses 64-bit integers.
    pub position_ms: Option<u32>,
    pub duration_ms: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum MediaCommand {
    Play,
    Pause,
    TogglePlayPause,
    Next,
    Previous,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
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

/// The foreground window, enough to decide whether the notch must yield.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindow {
    pub title: String,
    pub process_name: String,
    pub bounds: Rect,
    pub is_fullscreen: bool,
}

/// A native top-level window handle (`HWND`) as an integer, so the shell crate never depends
/// on the `windows` crate. `0` is "no window".
pub type WindowHandle = isize;

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
