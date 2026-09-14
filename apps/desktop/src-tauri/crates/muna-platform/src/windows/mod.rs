//! Real Windows implementation. Only the power service is wired in M0 (it is the one API a
//! CI runner can call without hardware); every other service reports
//! [`PlatformError::Unsupported`] until its module milestone lands (docs/07-roadmap.md).
//!
//! Every Win32 call in this module checks its result and every `unsafe` block carries a
//! `// SAFETY:` comment (repository rule).

mod power;

use tokio::sync::broadcast;

use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::traits::{Audio, Bluetooth, Foreground, Media, Monitors, Platform, Power};
use crate::types::{
    AudioDevice, BatteryState, BluetoothDevice, ForegroundWindow, MediaCommand, MediaSession,
    MonitorInfo,
};

const EVENT_CAPACITY: usize = 256;

#[derive(Debug)]
pub struct WindowsPlatform {
    events: broadcast::Sender<PlatformEvent>,
}

impl Default for WindowsPlatform {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowsPlatform {
    #[must_use]
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(EVENT_CAPACITY);
        Self { events }
    }
}

impl Media for WindowsPlatform {
    fn sessions(&self) -> PlatformResult<Vec<MediaSession>> {
        Err(PlatformError::Unsupported("media sessions"))
    }

    fn send(&self, _source_app_id: &str, _command: MediaCommand) -> PlatformResult<()> {
        Err(PlatformError::Unsupported("media commands"))
    }
}

impl Audio for WindowsPlatform {
    fn devices(&self) -> PlatformResult<Vec<AudioDevice>> {
        Err(PlatformError::Unsupported("audio devices"))
    }

    fn volume(&self) -> PlatformResult<u8> {
        Err(PlatformError::Unsupported("audio volume"))
    }

    fn set_volume(&self, _percent: u8) -> PlatformResult<()> {
        Err(PlatformError::Unsupported("audio volume"))
    }

    fn set_default_device(&self, _id: &str) -> PlatformResult<()> {
        Err(PlatformError::Unsupported("audio default device"))
    }
}

impl Bluetooth for WindowsPlatform {
    fn devices(&self) -> PlatformResult<Vec<BluetoothDevice>> {
        Err(PlatformError::Unsupported("bluetooth"))
    }

    fn connect(&self, _id: &str) -> PlatformResult<()> {
        Err(PlatformError::Unsupported("bluetooth"))
    }

    fn disconnect(&self, _id: &str) -> PlatformResult<()> {
        Err(PlatformError::Unsupported("bluetooth"))
    }
}

impl Power for WindowsPlatform {
    fn battery(&self) -> PlatformResult<BatteryState> {
        power::battery()
    }
}

impl Monitors for WindowsPlatform {
    fn all(&self) -> PlatformResult<Vec<MonitorInfo>> {
        Err(PlatformError::Unsupported("monitors"))
    }
}

impl Foreground for WindowsPlatform {
    fn current(&self) -> PlatformResult<Option<ForegroundWindow>> {
        Err(PlatformError::Unsupported("foreground tracking"))
    }
}

impl Platform for WindowsPlatform {
    fn media(&self) -> &dyn Media {
        self
    }

    fn audio(&self) -> &dyn Audio {
        self
    }

    fn bluetooth(&self) -> &dyn Bluetooth {
        self
    }

    fn power(&self) -> &dyn Power {
        self
    }

    fn monitors(&self) -> &dyn Monitors {
        self
    }

    fn foreground(&self) -> &dyn Foreground {
        self
    }

    fn subscribe(&self) -> broadcast::Receiver<PlatformEvent> {
        self.events.subscribe()
    }

    fn name(&self) -> &'static str {
        "windows"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_services_degrade_instead_of_panicking() {
        let platform = WindowsPlatform::new();
        assert!(matches!(
            platform.media().sessions(),
            Err(PlatformError::Unsupported(_))
        ));
        assert!(matches!(
            platform.monitors().all(),
            Err(PlatformError::Unsupported(_))
        ));
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn battery_reports_a_valid_state() {
        let state = WindowsPlatform::new().power().battery().unwrap();
        if let Some(percent) = state.percent {
            assert!(percent <= 100);
        }
    }
}
