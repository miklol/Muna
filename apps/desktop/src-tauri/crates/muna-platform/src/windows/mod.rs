//! Real Windows implementation. M0 wires the services the notch shell needs (power, monitors,
//! foreground tracking and window affinities, ADR-0002); every other service reports
//! [`PlatformError::Unsupported`] until its module milestone lands (docs/07-roadmap.md).
//!
//! Every Win32 call in this module checks its result and every `unsafe` block carries a
//! `// SAFETY:` comment (repository rule).

mod foreground;
pub mod identity;
mod monitors;
mod power;
mod pump;
pub mod webview;
mod window;

use tokio::sync::broadcast;
use tracing::warn;
use windows::Win32::Foundation::GetLastError;

use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::traits::{Audio, Bluetooth, Foreground, Media, Monitors, Platform, Power, Windowing};
use crate::types::{
    AudioDevice, BatteryState, BluetoothDevice, ForegroundWindow, MediaCommand, MediaSession,
    MonitorInfo, Rect, UserNotificationState, WindowHandle,
};

const EVENT_CAPACITY: usize = 256;

/// [`PlatformError::Os`] from `GetLastError` for APIs that report failure through a BOOL.
fn last_error(api: &'static str) -> PlatformError {
    // SAFETY: `GetLastError` has no preconditions; it reads the calling thread's last error.
    #[allow(unsafe_code)]
    let code = unsafe { GetLastError() };
    PlatformError::Os { api, code: code.0 }
}

/// [`PlatformError::Os`] from a `windows::core::Error` (HRESULT-returning APIs).
fn os_error(api: &'static str, error: &windows::core::Error) -> PlatformError {
    PlatformError::Os {
        api,
        code: error.code().0.cast_unsigned(),
    }
}

#[derive(Debug)]
pub struct WindowsPlatform {
    events: broadcast::Sender<PlatformEvent>,
    /// `None` when the pump could not start; polling still works, only push events are lost.
    _pump: Option<pump::Pump>,
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
        let pump = match pump::Pump::start(events.clone()) {
            Ok(pump) => Some(pump),
            Err(error) => {
                warn!(%error, "platform pump unavailable; monitor and foreground events disabled");
                None
            }
        };
        Self {
            events,
            _pump: pump,
        }
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
        monitors::enumerate()
    }
}

impl Foreground for WindowsPlatform {
    fn current(&self) -> PlatformResult<Option<ForegroundWindow>> {
        Ok(foreground::current())
    }
}

impl Windowing for WindowsPlatform {
    fn extended_style(&self, window: WindowHandle) -> PlatformResult<u32> {
        window::extended_style(window)
    }

    fn move_async(&self, window: WindowHandle, rect: Rect) -> PlatformResult<()> {
        window::move_async(window, rect)
    }

    fn assert_topmost(&self, window: WindowHandle) -> PlatformResult<()> {
        window::assert_topmost(window)
    }

    fn set_tool_window(&self, window: WindowHandle) -> PlatformResult<u32> {
        window::set_tool_window(window)
    }

    fn set_click_through(&self, window: WindowHandle, click_through: bool) -> PlatformResult<()> {
        window::set_click_through(window, click_through)
    }

    fn set_capture_exclusion(&self, window: WindowHandle, excluded: bool) -> PlatformResult<()> {
        window::set_capture_exclusion(window, excluded)
    }

    fn window_rect(&self, window: WindowHandle) -> PlatformResult<Rect> {
        window::window_rect(window)
    }

    fn cursor_position(&self) -> PlatformResult<(i32, i32)> {
        window::cursor_position()
    }

    fn window_at(&self, x: i32, y: i32) -> PlatformResult<WindowHandle> {
        Ok(window::window_at(x, y))
    }

    fn user_notification_state(&self) -> PlatformResult<UserNotificationState> {
        window::user_notification_state()
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

    fn windowing(&self) -> &dyn Windowing {
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
            platform.bluetooth().devices(),
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
