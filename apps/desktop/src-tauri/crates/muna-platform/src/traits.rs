//! Service traits. Methods are synchronous and cheap: implementations either answer from a
//! cache maintained by their own background threads or issue a non-blocking OS call. Anything
//! that must wait for the OS reports back through [`PlatformEvent`].

use tokio::sync::broadcast;

use crate::error::PlatformResult;
use crate::events::PlatformEvent;
use crate::types::{
    AudioDevice, BatteryState, BluetoothDevice, ForegroundWindow, MediaCommand, MediaSession,
    MonitorInfo,
};

/// System Media Transport Controls (docs/modules/media.md).
pub trait Media: Send + Sync {
    /// All current sessions; the media module scores them to pick the active one.
    fn sessions(&self) -> PlatformResult<Vec<MediaSession>>;
    fn send(&self, source_app_id: &str, command: MediaCommand) -> PlatformResult<()>;
}

/// Core Audio render endpoint (docs/modules/hud.md).
pub trait Audio: Send + Sync {
    fn devices(&self) -> PlatformResult<Vec<AudioDevice>>;
    /// Master volume of the default render device, 0–100.
    fn volume(&self) -> PlatformResult<u8>;
    fn set_volume(&self, percent: u8) -> PlatformResult<()>;
    fn set_default_device(&self, id: &str) -> PlatformResult<()>;
}

/// `WinRT` Bluetooth (docs/modules/bluetooth.md).
pub trait Bluetooth: Send + Sync {
    fn devices(&self) -> PlatformResult<Vec<BluetoothDevice>>;
    fn connect(&self, id: &str) -> PlatformResult<()>;
    fn disconnect(&self, id: &str) -> PlatformResult<()>;
}

/// Battery and power source.
pub trait Power: Send + Sync {
    fn battery(&self) -> PlatformResult<BatteryState>;
}

/// Display topology, needed for one notch window per monitor (ADR-0002).
pub trait Monitors: Send + Sync {
    fn all(&self) -> PlatformResult<Vec<MonitorInfo>>;
}

/// Foreground window tracking for the yield rules (docs/modules/notch-shell.md).
pub trait Foreground: Send + Sync {
    fn current(&self) -> PlatformResult<Option<ForegroundWindow>>;
}

/// The whole platform: every service plus the event stream.
pub trait Platform: Send + Sync {
    fn media(&self) -> &dyn Media;
    fn audio(&self) -> &dyn Audio;
    fn bluetooth(&self) -> &dyn Bluetooth;
    fn power(&self) -> &dyn Power;
    fn monitors(&self) -> &dyn Monitors;
    fn foreground(&self) -> &dyn Foreground;

    /// New receiver for platform events. Events published before the call are not replayed.
    fn subscribe(&self) -> broadcast::Receiver<PlatformEvent>;

    /// Human-readable implementation name for diagnostics (`"windows"`, `"fake"`).
    fn name(&self) -> &'static str;
}
