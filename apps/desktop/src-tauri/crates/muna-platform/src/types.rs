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
