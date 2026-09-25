//! Real Windows implementation. M0 wires the services the notch shell needs (power, monitors,
//! foreground tracking and window affinities, ADR-0002); M1 adds paired Bluetooth devices for
//! the live-activities strip; M2 adds System Media Transport Controls sessions; every other
//! service reports [`PlatformError::Unsupported`] until its module milestone lands
//! (docs/07-roadmap.md).
//!
//! Every Win32 call in this module checks its result and every `unsafe` block carries a
//! `// SAFETY:` comment (repository rule).

mod app_bar;
mod audio;
mod autostart;
mod bluetooth;
mod brightness;
mod foreground;
pub mod identity;
mod media;
mod monitors;
mod power;
mod pump;
pub mod undocumented;
pub mod webview;
mod window;

use tokio::sync::broadcast;
use tracing::warn;
use windows::Win32::Foundation::GetLastError;

pub use autostart::{AUTOSTART_ARG, STARTUP_TASK_ID};

use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::traits::{
    AppBar, Audio, Autostart, Bluetooth, Brightness, Foreground, Media, Monitors, Platform, Power,
    SystemOsd, Windowing,
};
use crate::types::{
    AudioDevice, AutostartMechanism, BatteryState, BluetoothDevice, BrightnessMonitor,
    ForegroundWindow, MediaCommand, MediaSession, MonitorInfo, OsdState, Rect, Thumbnail,
    UserNotificationState, WindowHandle,
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
    /// `None` when the watchers could not start; Bluetooth then reports `Unsupported`.
    bluetooth: Option<bluetooth::Watcher>,
    /// `None` when the worker could not start; media then reports `Unsupported`.
    media: Option<media::Watcher>,
    /// `None` when the worker could not start; volume then reports `Unsupported`.
    audio: Option<audio::Watcher>,
    /// `None` when the worker could not start; brightness then reports `Unsupported`.
    brightness: Option<brightness::Watcher>,
    /// `None` when the keeper thread could not start; the native flyout then stays visible.
    osd: Option<undocumented::flyout::Keeper>,
    app_bars: app_bar::AppBars,
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
        let bluetooth = match bluetooth::Watcher::start(events.clone()) {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                warn!(%error, "bluetooth watcher unavailable; device notices disabled");
                None
            }
        };
        let media = match media::Watcher::start(events.clone()) {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                warn!(%error, "media watcher unavailable; now playing disabled");
                None
            }
        };
        let audio = match audio::Watcher::start(events.clone()) {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                warn!(%error, "audio watcher unavailable; volume HUD disabled");
                None
            }
        };
        let brightness = match brightness::Watcher::start(events.clone()) {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                warn!(%error, "brightness watcher unavailable; brightness HUD disabled");
                None
            }
        };
        let osd = match undocumented::flyout::Keeper::start() {
            Ok(keeper) => Some(keeper),
            Err(error) => {
                warn!(%error, "flyout keeper unavailable; the native OSD stays visible");
                None
            }
        };
        Self {
            events,
            _pump: pump,
            bluetooth,
            media,
            audio,
            brightness,
            osd,
            app_bars: app_bar::AppBars::default(),
        }
    }
}

impl Media for WindowsPlatform {
    fn sessions(&self) -> PlatformResult<Vec<MediaSession>> {
        self.media
            .as_ref()
            .map(media::Watcher::sessions)
            .ok_or(PlatformError::Unsupported("media sessions"))
    }

    fn thumbnail(&self, source_app_id: &str) -> PlatformResult<Option<Thumbnail>> {
        self.media
            .as_ref()
            .ok_or(PlatformError::Unsupported("media thumbnails"))?
            .thumbnail(source_app_id)
    }

    fn send(&self, source_app_id: &str, command: MediaCommand) -> PlatformResult<()> {
        self.media
            .as_ref()
            .ok_or(PlatformError::Unsupported("media commands"))?
            .send(source_app_id, command)
    }

    fn refresh(&self) -> PlatformResult<()> {
        self.media
            .as_ref()
            .ok_or(PlatformError::Unsupported("media sessions"))?
            .refresh()
    }
}

impl Audio for WindowsPlatform {
    fn devices(&self) -> PlatformResult<Vec<AudioDevice>> {
        self.audio
            .as_ref()
            .map(audio::Watcher::devices)
            .ok_or(PlatformError::Unsupported("audio devices"))
    }

    fn volume(&self) -> PlatformResult<u8> {
        self.audio_watcher()?.volume()
    }

    fn set_volume(&self, percent: u8) -> PlatformResult<()> {
        self.audio_watcher()?.set_volume(percent)
    }

    fn muted(&self) -> PlatformResult<bool> {
        self.audio_watcher()?.muted()
    }

    fn set_muted(&self, muted: bool) -> PlatformResult<()> {
        self.audio_watcher()?.set_muted(muted)
    }

    fn mic_muted(&self) -> PlatformResult<Option<bool>> {
        Ok(self.audio_watcher()?.mic_muted())
    }

    fn set_mic_muted(&self, muted: bool) -> PlatformResult<()> {
        self.audio_watcher()?.set_mic_muted(muted)
    }

    // Needs the undocumented `IPolicyConfig`; the P1 audio-output picker owns that (docs/04).
    fn set_default_device(&self, _id: &str) -> PlatformResult<()> {
        Err(PlatformError::Unsupported("audio default device"))
    }
}

impl WindowsPlatform {
    fn audio_watcher(&self) -> PlatformResult<&audio::Watcher> {
        self.audio
            .as_ref()
            .ok_or(PlatformError::Unsupported("audio volume"))
    }
}

impl Brightness for WindowsPlatform {
    fn monitors(&self) -> PlatformResult<Vec<BrightnessMonitor>> {
        self.brightness
            .as_ref()
            .map(brightness::Watcher::monitors)
            .ok_or(PlatformError::Unsupported("brightness"))
    }

    fn set(&self, id: &str, percent: u8) -> PlatformResult<()> {
        self.brightness
            .as_ref()
            .ok_or(PlatformError::Unsupported("brightness"))?
            .set(id, percent)
    }
}

impl SystemOsd for WindowsPlatform {
    fn set_suppressed(&self, suppressed: bool) -> PlatformResult<OsdState> {
        match &self.osd {
            Some(keeper) => keeper.set_suppressed(suppressed),
            None => Ok(OsdState::Unavailable),
        }
    }

    fn state(&self) -> OsdState {
        self.osd
            .as_ref()
            .map_or(OsdState::Unavailable, undocumented::flyout::Keeper::state)
    }
}

impl Bluetooth for WindowsPlatform {
    fn devices(&self) -> PlatformResult<Vec<BluetoothDevice>> {
        self.bluetooth
            .as_ref()
            .map(bluetooth::Watcher::devices)
            .ok_or(PlatformError::Unsupported("bluetooth"))
    }

    // Classic connect/disconnect need `BluetoothSetServiceState` (docs/04 ⚠️); the P1 module
    // owns that.
    fn connect(&self, _id: &str) -> PlatformResult<()> {
        Err(PlatformError::Unsupported("bluetooth connect"))
    }

    fn disconnect(&self, _id: &str) -> PlatformResult<()> {
        Err(PlatformError::Unsupported("bluetooth disconnect"))
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

    fn set_no_activate(&self, window: WindowHandle, no_activate: bool) -> PlatformResult<()> {
        window::set_no_activate(window, no_activate)
    }

    fn window_rect(&self, window: WindowHandle) -> PlatformResult<Rect> {
        window::window_rect(window)
    }

    fn cursor_position(&self) -> PlatformResult<(i32, i32)> {
        window::cursor_position()
    }

    fn pointer_button_down(&self) -> PlatformResult<bool> {
        Ok(window::pointer_button_down())
    }

    fn window_at(&self, x: i32, y: i32) -> PlatformResult<WindowHandle> {
        Ok(window::window_at(x, y))
    }

    fn user_notification_state(&self) -> PlatformResult<UserNotificationState> {
        window::user_notification_state()
    }
}

impl AppBar for WindowsPlatform {
    fn reserve_top(
        &self,
        window: WindowHandle,
        monitor: Rect,
        height: u32,
    ) -> PlatformResult<Rect> {
        self.app_bars.reserve_top(window, monitor, height)
    }

    fn release(&self, window: WindowHandle) -> PlatformResult<()> {
        self.app_bars.release(window);
        Ok(())
    }
}

impl Autostart for WindowsPlatform {
    fn mechanism(&self) -> AutostartMechanism {
        autostart::mechanism()
    }

    fn is_enabled(&self) -> PlatformResult<bool> {
        autostart::is_enabled()
    }

    fn set_enabled(&self, enabled: bool) -> PlatformResult<()> {
        autostart::set_enabled(enabled)
    }
}

impl Platform for WindowsPlatform {
    fn media(&self) -> &dyn Media {
        self
    }

    fn audio(&self) -> &dyn Audio {
        self
    }

    fn brightness(&self) -> &dyn Brightness {
        self
    }

    fn system_osd(&self) -> &dyn SystemOsd {
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

    fn app_bar(&self) -> &dyn AppBar {
        self
    }

    fn autostart(&self) -> &dyn Autostart {
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
        // The default-device switch is still the P1 picker's job.
        assert!(matches!(
            platform.audio().set_default_device("any"),
            Err(PlatformError::Unsupported(_))
        ));
        // Volume answers, or says why not, but never panics: a machine without a render
        // endpoint is `NotFound`, one where the worker could not start is `Unsupported`.
        match platform.audio().volume() {
            Ok(percent) => assert!(percent <= 100),
            Err(PlatformError::NotFound(_) | PlatformError::Unsupported(_)) => {}
            Err(other) => panic!("unexpected error: {other}"),
        }
        assert!(matches!(
            platform.bluetooth().connect("any"),
            Err(PlatformError::Unsupported(_))
        ));
        // A session that does not exist is `NotFound`, never a panic; a machine that cannot
        // start the worker degrades to `Unsupported`.
        match platform.media().send("Nope.exe", MediaCommand::Play) {
            Err(PlatformError::NotFound(_) | PlatformError::Unsupported(_)) => {}
            other => panic!("unexpected result: {other:?}"),
        }
        // Enumeration works without a radio; a machine that cannot start the watchers degrades.
        match platform.bluetooth().devices() {
            Ok(devices) => assert!(
                devices
                    .iter()
                    .all(|device| device.battery_percent.is_none_or(|p| p <= 100))
            ),
            Err(PlatformError::Unsupported(_)) => {}
            Err(other) => panic!("unexpected error: {other}"),
        }
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
