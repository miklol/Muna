//! A scripted, deterministic platform used by every unit and integration test (docs/09).
//!
//! Tests drive it through the `push_*` / `set_*` methods; each call updates the snapshot the
//! traits return **and** publishes the matching [`PlatformEvent`], exactly as the real
//! implementation would. Commands sent to the fake are recorded so tests can assert on them.

use parking_lot::Mutex;
use tokio::sync::broadcast;

use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::traits::{
    AppBar, Audio, Autostart, Bluetooth, Brightness, Foreground, Media, Monitors, Platform, Power,
    SystemOsd, SystemStats, Windowing,
};
use crate::types::{
    AudioDevice, AutostartMechanism, BatteryState, BluetoothDevice, BrightnessMonitor,
    ForegroundWindow, MediaCommand, MediaSession, MonitorInfo, OsdState, PowerSource, Rect,
    SystemSample, Thumbnail, UserNotificationState, WindowHandle,
};

const EVENT_CAPACITY: usize = 256;

/// One recorded [`Windowing`] / [`AppBar`] call, in order, for assertions in shell tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowingCall {
    MoveAsync(WindowHandle, Rect),
    AssertTopmost(WindowHandle),
    SetToolWindow(WindowHandle),
    SetClickThrough(WindowHandle, bool),
    SetCaptureExclusion(WindowHandle, bool),
    SetNoActivate(WindowHandle, bool),
    /// `reserve_top(window, monitor, height)`.
    ReserveAppBar(WindowHandle, Rect, u32),
    ReleaseAppBar(WindowHandle),
}

/// Scripted mouse state: where the cursor is and whether a button is held.
#[derive(Debug, Default, Clone, Copy)]
struct Pointer {
    position: (i32, i32),
    button_down: bool,
}

/// A scripted state bag: the flags are independent test knobs, not a state machine.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug)]
struct State {
    sessions: Vec<MediaSession>,
    /// Scripted artwork per `source_app_id`.
    thumbnails: Vec<(String, Thumbnail)>,
    media_refreshes: usize,
    audio_devices: Vec<AudioDevice>,
    volume: u8,
    muted: bool,
    /// `None` scripts a machine without a microphone.
    mic_muted: Option<bool>,
    brightness: Vec<BrightnessMonitor>,
    /// Every `set(id, percent)` the fake received, in order.
    brightness_sets: Vec<(String, u8)>,
    osd: OsdState,
    /// Scripted: the build has no flyout window, so suppression reports `Unavailable`.
    osd_unavailable: bool,
    /// Every `set_suppressed` request, in order.
    osd_requests: Vec<bool>,
    bluetooth: Vec<BluetoothDevice>,
    battery: BatteryState,
    monitors: Vec<MonitorInfo>,
    foreground: Option<ForegroundWindow>,
    sent_media_commands: Vec<(String, MediaCommand)>,
    pointer: Pointer,
    quiet: UserNotificationState,
    window_rects: Vec<(WindowHandle, Rect)>,
    windowing_calls: Vec<WindowingCall>,
    /// Windows with a live `AppBar` reservation and the rect granted.
    app_bars: Vec<(WindowHandle, Rect)>,
    autostart_enabled: bool,
    /// Scripted: `set_enabled(true)` fails with `AccessDenied` (user disabled it in Settings).
    autostart_denied: bool,
    /// Scripted readings, oldest first; the last one repeats once the script runs out.
    system_samples: Vec<SystemSample>,
    /// Every `sample(top_processes)` the fake answered, in order.
    system_sample_requests: Vec<usize>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            sessions: Vec::new(),
            thumbnails: Vec::new(),
            media_refreshes: 0,
            audio_devices: vec![AudioDevice {
                id: "fake-speakers".into(),
                name: "Speakers (fake)".into(),
                is_default: true,
            }],
            volume: 50,
            muted: false,
            mic_muted: Some(false),
            brightness: Vec::new(),
            brightness_sets: Vec::new(),
            osd: OsdState::Native,
            osd_unavailable: false,
            osd_requests: Vec::new(),
            bluetooth: Vec::new(),
            battery: BatteryState {
                percent: None,
                source: PowerSource::Ac,
                charging: false,
            },
            monitors: vec![MonitorInfo {
                id: r"\\.\DISPLAY1".into(),
                bounds: Rect::new(0, 0, 2560, 1440),
                work_area: Rect::new(0, 0, 2560, 1392),
                dpi: 96,
                is_primary: true,
            }],
            foreground: None,
            sent_media_commands: Vec::new(),
            pointer: Pointer::default(),
            quiet: UserNotificationState::AcceptsNotifications,
            window_rects: Vec::new(),
            windowing_calls: Vec::new(),
            app_bars: Vec::new(),
            autostart_enabled: false,
            autostart_denied: false,
            system_samples: Vec::new(),
            system_sample_requests: Vec::new(),
        }
    }
}

/// Scripted platform. Cheap to clone-by-`Arc`; all methods take `&self`.
#[derive(Debug)]
pub struct FakePlatform {
    state: Mutex<State>,
    events: broadcast::Sender<PlatformEvent>,
}

impl Default for FakePlatform {
    fn default() -> Self {
        Self::new()
    }
}

impl FakePlatform {
    #[must_use]
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(EVENT_CAPACITY);
        Self {
            state: Mutex::new(State::default()),
            events,
        }
    }

    fn publish(&self, event: PlatformEvent) {
        // No subscribers is fine: the app may not have mounted a listener yet.
        let _ = self.events.send(event);
    }

    // --- scripting API -----------------------------------------------------------------

    /// Replaces the media session list and notifies subscribers.
    pub fn set_media_sessions(&self, sessions: Vec<MediaSession>) {
        self.state.lock().sessions.clone_from(&sessions);
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    /// Adds (or replaces, by `source_app_id`) one media session and notifies subscribers.
    pub fn push_media_session(&self, session: MediaSession) {
        let sessions = {
            let mut state = self.state.lock();
            state
                .sessions
                .retain(|s| s.source_app_id != session.source_app_id);
            state.sessions.push(session);
            state.sessions.clone()
        };
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    /// Removes a session (the app closed) and notifies subscribers.
    pub fn remove_media_session(&self, source_app_id: &str) {
        let sessions = {
            let mut state = self.state.lock();
            state.sessions.retain(|s| s.source_app_id != source_app_id);
            state.thumbnails.retain(|(app, _)| app != source_app_id);
            state.sessions.clone()
        };
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    /// Scripts the artwork of a known session: stores the bytes, bumps the session's
    /// `art_version` and republishes, exactly as the real implementation does when a late
    /// thumbnail lands. Ignored for unknown sessions.
    pub fn set_media_thumbnail(&self, source_app_id: &str, bytes: Vec<u8>, content_type: &str) {
        let sessions = {
            let mut state = self.state.lock();
            let Some(session) = state
                .sessions
                .iter_mut()
                .find(|s| s.source_app_id == source_app_id)
            else {
                return;
            };
            session.art_version += 1;
            state.thumbnails.retain(|(app, _)| app != source_app_id);
            state.thumbnails.push((
                source_app_id.to_owned(),
                Thumbnail {
                    bytes,
                    content_type: content_type.to_owned(),
                },
            ));
            state.sessions.clone()
        };
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    /// How many times [`Media::refresh`] was called.
    #[must_use]
    pub fn media_refreshes(&self) -> usize {
        self.state.lock().media_refreshes
    }

    pub fn set_volume_state(&self, percent: u8, muted: bool) {
        let percent = percent.min(100);
        {
            let mut state = self.state.lock();
            state.volume = percent;
            state.muted = muted;
        }
        self.publish(PlatformEvent::VolumeChanged { percent, muted });
    }

    /// Scripts the default microphone's mute state; `None` removes the microphone.
    pub fn set_mic_muted_state(&self, muted: Option<bool>) {
        self.state.lock().mic_muted = muted;
        if let Some(muted) = muted {
            self.publish(PlatformEvent::MicMuteChanged { muted });
        }
    }

    /// Adds (or replaces, by id) a brightness-capable monitor without publishing anything —
    /// the probe found it at start-up.
    pub fn add_brightness_monitor(&self, monitor: BrightnessMonitor) {
        let mut state = self.state.lock();
        state.brightness.retain(|m| m.id != monitor.id);
        state.brightness.push(monitor);
    }

    /// Scripts a brightness change from outside Muna (a laptop's brightness keys) and
    /// notifies subscribers. Ignored for unknown monitors.
    pub fn set_brightness_state(&self, id: &str, percent: u8) {
        let percent = percent.min(100);
        {
            let mut state = self.state.lock();
            let Some(monitor) = state.brightness.iter_mut().find(|m| m.id == id) else {
                return;
            };
            monitor.percent = percent;
        }
        self.publish(PlatformEvent::BrightnessChanged {
            monitor_id: id.to_owned(),
            percent,
        });
    }

    /// Every [`Brightness::set`] the fake received, in order.
    #[must_use]
    pub fn brightness_sets(&self) -> Vec<(String, u8)> {
        self.state.lock().brightness_sets.clone()
    }

    /// Scripts a build without a flyout window: suppression reports `Unavailable`.
    pub fn set_osd_unavailable(&self, unavailable: bool) {
        let mut state = self.state.lock();
        state.osd_unavailable = unavailable;
        if unavailable {
            state.osd = OsdState::Unavailable;
        }
    }

    /// Every [`SystemOsd::set_suppressed`] request, in order.
    #[must_use]
    pub fn osd_requests(&self) -> Vec<bool> {
        self.state.lock().osd_requests.clone()
    }

    pub fn set_bluetooth_device(&self, device: BluetoothDevice) {
        {
            let mut state = self.state.lock();
            state.bluetooth.retain(|d| d.id != device.id);
            state.bluetooth.push(device.clone());
        }
        self.publish(PlatformEvent::BluetoothChanged(device));
    }

    pub fn set_battery(&self, battery: BatteryState) {
        self.state.lock().battery = battery;
        self.publish(PlatformEvent::BatteryChanged(battery));
    }

    pub fn set_monitors(&self, monitors: Vec<MonitorInfo>) {
        self.state.lock().monitors.clone_from(&monitors);
        self.publish(PlatformEvent::MonitorsChanged(monitors));
    }

    pub fn foreground_changed(&self, window: ForegroundWindow) {
        self.state.lock().foreground = Some(window.clone());
        self.publish(PlatformEvent::ForegroundChanged(window));
    }

    pub fn set_session_locked(&self, locked: bool) {
        self.publish(PlatformEvent::SessionLockChanged { locked });
    }

    /// A window drag or resize started (`true`) or ended (`false`).
    pub fn move_size_changed(&self, started: bool) {
        self.publish(PlatformEvent::MoveSizeChanged { started });
    }

    /// Windows with a live `AppBar` reservation and the rect each was granted.
    #[must_use]
    pub fn app_bars(&self) -> Vec<(WindowHandle, Rect)> {
        self.state.lock().app_bars.clone()
    }

    /// Scripts whether enabling autostart is refused (the user turned the startup task off in
    /// Windows settings, `StartupTaskState::DisabledByUser`).
    pub fn set_autostart_denied(&self, denied: bool) {
        self.state.lock().autostart_denied = denied;
    }

    /// Media commands received so far, in order.
    #[must_use]
    pub fn sent_media_commands(&self) -> Vec<(String, MediaCommand)> {
        self.state.lock().sent_media_commands.clone()
    }

    /// Scripts the cursor position returned by [`Windowing::cursor_position`].
    pub fn set_cursor(&self, x: i32, y: i32) {
        self.state.lock().pointer.position = (x, y);
    }

    /// Scripts [`Windowing::pointer_button_down`] (a mouse button held anywhere on screen).
    pub fn set_pointer_button_down(&self, down: bool) {
        self.state.lock().pointer.button_down = down;
    }

    /// Scripts [`Windowing::user_notification_state`].
    pub fn set_user_notification_state(&self, state: UserNotificationState) {
        self.state.lock().quiet = state;
    }

    /// [`Windowing`] calls received so far, in order.
    #[must_use]
    pub fn windowing_calls(&self) -> Vec<WindowingCall> {
        self.state.lock().windowing_calls.clone()
    }

    /// Scripts the readings [`SystemStats::sample`] hands out, oldest first. The last reading
    /// repeats once the script runs out; with no script the sampler reports `Unsupported`.
    pub fn script_system_samples(&self, samples: Vec<SystemSample>) {
        let mut state = self.state.lock();
        state.system_samples = samples;
        state.system_samples.reverse();
    }

    /// The `top_processes` argument of every sample taken so far, in order — how often the
    /// module sampled and whether it walked the processes.
    #[must_use]
    pub fn system_sample_requests(&self) -> Vec<usize> {
        self.state.lock().system_sample_requests.clone()
    }
}

impl SystemStats for FakePlatform {
    fn sample(&self, top_processes: usize) -> PlatformResult<SystemSample> {
        let mut state = self.state.lock();
        state.system_sample_requests.push(top_processes);
        let sample = if state.system_samples.len() > 1 {
            state.system_samples.pop()
        } else {
            state.system_samples.last().cloned()
        };
        let mut sample = sample.ok_or(PlatformError::Unsupported("system stats"))?;
        sample.processes.truncate(top_processes);
        Ok(sample)
    }
}

impl Windowing for FakePlatform {
    fn extended_style(&self, _window: WindowHandle) -> PlatformResult<u32> {
        // WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, the shape the shell wants.
        Ok(0x0000_0008 | 0x0000_0080 | 0x0800_0000)
    }

    fn set_tool_window(&self, window: WindowHandle) -> PlatformResult<u32> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::SetToolWindow(window));
        self.extended_style(window)
    }

    fn set_click_through(&self, window: WindowHandle, click_through: bool) -> PlatformResult<()> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::SetClickThrough(window, click_through));
        Ok(())
    }

    fn move_async(&self, window: WindowHandle, rect: Rect) -> PlatformResult<()> {
        let mut state = self.state.lock();
        state.window_rects.retain(|(handle, _)| *handle != window);
        state.window_rects.push((window, rect));
        state
            .windowing_calls
            .push(WindowingCall::MoveAsync(window, rect));
        Ok(())
    }

    fn assert_topmost(&self, window: WindowHandle) -> PlatformResult<()> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::AssertTopmost(window));
        Ok(())
    }

    fn set_capture_exclusion(&self, window: WindowHandle, excluded: bool) -> PlatformResult<()> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::SetCaptureExclusion(window, excluded));
        Ok(())
    }

    fn set_no_activate(&self, window: WindowHandle, no_activate: bool) -> PlatformResult<()> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::SetNoActivate(window, no_activate));
        Ok(())
    }

    fn window_rect(&self, window: WindowHandle) -> PlatformResult<Rect> {
        self.state
            .lock()
            .window_rects
            .iter()
            .find(|(handle, _)| *handle == window)
            .map(|(_, rect)| *rect)
            .ok_or_else(|| PlatformError::NotFound(format!("window {window}")))
    }

    fn cursor_position(&self) -> PlatformResult<(i32, i32)> {
        Ok(self.state.lock().pointer.position)
    }

    fn pointer_button_down(&self) -> PlatformResult<bool> {
        Ok(self.state.lock().pointer.button_down)
    }

    fn window_at(&self, x: i32, y: i32) -> PlatformResult<WindowHandle> {
        Ok(self
            .state
            .lock()
            .window_rects
            .iter()
            .find(|(_, rect)| rect.contains(x, y))
            .map_or(0, |(handle, _)| *handle))
    }

    fn user_notification_state(&self) -> PlatformResult<UserNotificationState> {
        Ok(self.state.lock().quiet)
    }
}

impl AppBar for FakePlatform {
    fn reserve_top(
        &self,
        window: WindowHandle,
        monitor: Rect,
        height: u32,
    ) -> PlatformResult<Rect> {
        let granted = Rect::new(monitor.x, monitor.y, monitor.width, height);
        let mut state = self.state.lock();
        state.app_bars.retain(|(handle, _)| *handle != window);
        state.app_bars.push((window, granted));
        state
            .windowing_calls
            .push(WindowingCall::ReserveAppBar(window, monitor, height));
        Ok(granted)
    }

    fn release(&self, window: WindowHandle) -> PlatformResult<()> {
        let mut state = self.state.lock();
        let before = state.app_bars.len();
        state.app_bars.retain(|(handle, _)| *handle != window);
        if state.app_bars.len() != before {
            state
                .windowing_calls
                .push(WindowingCall::ReleaseAppBar(window));
        }
        Ok(())
    }
}

impl Autostart for FakePlatform {
    fn mechanism(&self) -> AutostartMechanism {
        AutostartMechanism::None
    }

    fn is_enabled(&self) -> PlatformResult<bool> {
        Ok(self.state.lock().autostart_enabled)
    }

    fn set_enabled(&self, enabled: bool) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if enabled && state.autostart_denied {
            return Err(PlatformError::AccessDenied("startup task"));
        }
        state.autostart_enabled = enabled;
        Ok(())
    }
}

impl Media for FakePlatform {
    fn sessions(&self) -> PlatformResult<Vec<MediaSession>> {
        Ok(self.state.lock().sessions.clone())
    }

    fn thumbnail(&self, source_app_id: &str) -> PlatformResult<Option<Thumbnail>> {
        let state = self.state.lock();
        if !state
            .sessions
            .iter()
            .any(|s| s.source_app_id == source_app_id)
        {
            return Err(PlatformError::NotFound(format!(
                "media session {source_app_id}"
            )));
        }
        Ok(state
            .thumbnails
            .iter()
            .find(|(app, _)| app == source_app_id)
            .map(|(_, thumbnail)| thumbnail.clone()))
    }

    fn send(&self, source_app_id: &str, command: MediaCommand) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if !state
            .sessions
            .iter()
            .any(|s| s.source_app_id == source_app_id)
        {
            return Err(PlatformError::NotFound(format!(
                "media session {source_app_id}"
            )));
        }
        state
            .sent_media_commands
            .push((source_app_id.to_owned(), command));
        Ok(())
    }

    fn refresh(&self) -> PlatformResult<()> {
        self.state.lock().media_refreshes += 1;
        Ok(())
    }
}

impl Audio for FakePlatform {
    fn devices(&self) -> PlatformResult<Vec<AudioDevice>> {
        Ok(self.state.lock().audio_devices.clone())
    }

    fn volume(&self) -> PlatformResult<u8> {
        Ok(self.state.lock().volume)
    }

    fn set_volume(&self, percent: u8) -> PlatformResult<()> {
        let muted = self.state.lock().muted;
        self.set_volume_state(percent, muted);
        Ok(())
    }

    fn muted(&self) -> PlatformResult<bool> {
        Ok(self.state.lock().muted)
    }

    fn set_muted(&self, muted: bool) -> PlatformResult<()> {
        let percent = self.state.lock().volume;
        self.set_volume_state(percent, muted);
        Ok(())
    }

    fn mic_muted(&self) -> PlatformResult<Option<bool>> {
        Ok(self.state.lock().mic_muted)
    }

    fn set_mic_muted(&self, muted: bool) -> PlatformResult<()> {
        if self.state.lock().mic_muted.is_none() {
            return Err(PlatformError::NotFound("default capture device".into()));
        }
        self.set_mic_muted_state(Some(muted));
        Ok(())
    }

    fn set_default_device(&self, id: &str) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if !state.audio_devices.iter().any(|d| d.id == id) {
            return Err(PlatformError::NotFound(format!("audio device {id}")));
        }
        for device in &mut state.audio_devices {
            device.is_default = device.id == id;
        }
        Ok(())
    }
}

impl Brightness for FakePlatform {
    fn monitors(&self) -> PlatformResult<Vec<BrightnessMonitor>> {
        Ok(self.state.lock().brightness.clone())
    }

    fn set(&self, id: &str, percent: u8) -> PlatformResult<()> {
        let percent = percent.min(100);
        {
            let mut state = self.state.lock();
            if !state.brightness.iter().any(|m| m.id == id) {
                return Err(PlatformError::NotFound(format!("brightness monitor {id}")));
            }
            state.brightness_sets.push((id.to_owned(), percent));
        }
        // The real implementation answers through the event once the monitor confirmed.
        self.set_brightness_state(id, percent);
        Ok(())
    }
}

impl SystemOsd for FakePlatform {
    fn set_suppressed(&self, suppressed: bool) -> PlatformResult<OsdState> {
        let mut state = self.state.lock();
        state.osd_requests.push(suppressed);
        state.osd = if state.osd_unavailable {
            OsdState::Unavailable
        } else if suppressed {
            OsdState::Suppressed
        } else {
            OsdState::Native
        };
        Ok(state.osd)
    }

    fn state(&self) -> OsdState {
        self.state.lock().osd
    }
}

impl Bluetooth for FakePlatform {
    fn devices(&self) -> PlatformResult<Vec<BluetoothDevice>> {
        Ok(self.state.lock().bluetooth.clone())
    }

    fn connect(&self, id: &str) -> PlatformResult<()> {
        self.toggle_bluetooth(id, true)
    }

    fn disconnect(&self, id: &str) -> PlatformResult<()> {
        self.toggle_bluetooth(id, false)
    }
}

impl FakePlatform {
    fn toggle_bluetooth(&self, id: &str, connected: bool) -> PlatformResult<()> {
        let device = {
            let mut state = self.state.lock();
            let device = state
                .bluetooth
                .iter_mut()
                .find(|d| d.id == id)
                .ok_or_else(|| PlatformError::NotFound(format!("bluetooth device {id}")))?;
            device.connected = connected;
            device.clone()
        };
        self.publish(PlatformEvent::BluetoothChanged(device));
        Ok(())
    }
}

impl Power for FakePlatform {
    fn battery(&self) -> PlatformResult<BatteryState> {
        Ok(self.state.lock().battery)
    }
}

impl Monitors for FakePlatform {
    fn all(&self) -> PlatformResult<Vec<MonitorInfo>> {
        Ok(self.state.lock().monitors.clone())
    }
}

impl Foreground for FakePlatform {
    fn current(&self) -> PlatformResult<Option<ForegroundWindow>> {
        Ok(self.state.lock().foreground.clone())
    }
}

impl Platform for FakePlatform {
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

    fn system_stats(&self) -> &dyn SystemStats {
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
        "fake"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PlaybackStatus;

    fn session(app: &str, title: &str) -> MediaSession {
        MediaSession {
            artist: "Artist".into(),
            status: PlaybackStatus::Playing,
            position_ms: Some(0),
            duration_ms: Some(180_000),
            ..MediaSession::new(app, title)
        }
    }

    #[test]
    fn thumbnails_are_scripted_per_session_and_bump_the_art_version() {
        let fake = FakePlatform::new();
        fake.push_media_session(session("Spotify.exe", "Song"));
        assert_eq!(fake.media().thumbnail("Spotify.exe").unwrap(), None);
        assert!(matches!(
            fake.media().thumbnail("Nope.exe"),
            Err(PlatformError::NotFound(_))
        ));

        let mut rx = fake.subscribe();
        fake.set_media_thumbnail("Spotify.exe", vec![1, 2, 3], "image/png");
        let art = fake.media().thumbnail("Spotify.exe").unwrap().unwrap();
        assert_eq!(art.bytes, vec![1, 2, 3]);
        assert_eq!(art.content_type, "image/png");
        match rx.try_recv().unwrap() {
            PlatformEvent::MediaSessionsChanged(sessions) => {
                assert_eq!(sessions[0].art_version, 1);
            }
            other => panic!("unexpected event {other:?}"),
        }

        fake.remove_media_session("Spotify.exe");
        assert!(fake.media().sessions().unwrap().is_empty());
        assert_eq!(fake.media_refreshes(), 0);
        fake.media().refresh().unwrap();
        assert_eq!(fake.media_refreshes(), 1);
    }

    #[test]
    fn pushing_a_session_updates_snapshot_and_publishes_event() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();

        fake.push_media_session(session("Spotify.exe", "Song"));

        assert_eq!(fake.media().sessions().unwrap().len(), 1);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::MediaSessionsChanged(vec![session("Spotify.exe", "Song")])
        );
    }

    #[test]
    fn pushing_same_source_replaces_instead_of_duplicating() {
        let fake = FakePlatform::new();
        fake.push_media_session(session("Spotify.exe", "One"));
        fake.push_media_session(session("Spotify.exe", "Two"));

        let sessions = fake.media().sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "Two");
    }

    #[test]
    fn media_commands_are_recorded_for_known_sessions_only() {
        let fake = FakePlatform::new();
        assert_eq!(
            fake.media().send("Nope.exe", MediaCommand::Play),
            Err(PlatformError::NotFound("media session Nope.exe".into()))
        );

        fake.push_media_session(session("Spotify.exe", "Song"));
        fake.media()
            .send("Spotify.exe", MediaCommand::TogglePlayPause)
            .unwrap();
        assert_eq!(
            fake.sent_media_commands(),
            vec![("Spotify.exe".to_owned(), MediaCommand::TogglePlayPause)]
        );
    }

    #[test]
    fn volume_is_clamped_and_published() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();
        fake.audio().set_volume(250).unwrap();
        assert_eq!(fake.audio().volume().unwrap(), 100);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::VolumeChanged {
                percent: 100,
                muted: false
            }
        );
    }

    #[test]
    fn mute_keeps_the_level_and_publishes_one_event() {
        let fake = FakePlatform::new();
        fake.audio().set_volume(30).unwrap();
        let mut rx = fake.subscribe();
        fake.audio().set_muted(true).unwrap();
        assert!(fake.audio().muted().unwrap());
        assert_eq!(fake.audio().volume().unwrap(), 30);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::VolumeChanged {
                percent: 30,
                muted: true
            }
        );
    }

    #[test]
    fn microphone_mute_is_scripted_and_absent_when_there_is_no_capture_device() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();
        fake.audio().set_mic_muted(true).unwrap();
        assert_eq!(fake.audio().mic_muted().unwrap(), Some(true));
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::MicMuteChanged { muted: true }
        );

        fake.set_mic_muted_state(None);
        assert_eq!(fake.audio().mic_muted().unwrap(), None);
        assert!(matches!(
            fake.audio().set_mic_muted(false),
            Err(PlatformError::NotFound(_))
        ));
        assert!(rx.try_recv().is_err(), "removing the mic publishes nothing");
    }

    #[test]
    fn brightness_is_per_monitor_recorded_and_published() {
        use crate::types::BrightnessKind;
        let fake = FakePlatform::new();
        assert!(fake.brightness().monitors().unwrap().is_empty());
        assert!(matches!(
            fake.brightness().set("nope", 10),
            Err(PlatformError::NotFound(_))
        ));

        fake.add_brightness_monitor(BrightnessMonitor {
            id: r"\\.\DISPLAY1#0".into(),
            name: "DELL U2723QE".into(),
            percent: 40,
            kind: BrightnessKind::External,
        });
        let mut rx = fake.subscribe();
        fake.brightness().set(r"\\.\DISPLAY1#0", 180).unwrap();
        assert_eq!(fake.brightness().monitors().unwrap()[0].percent, 100);
        assert_eq!(
            fake.brightness_sets(),
            vec![(r"\\.\DISPLAY1#0".to_owned(), 100)]
        );
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::BrightnessChanged {
                monitor_id: r"\\.\DISPLAY1#0".into(),
                percent: 100
            }
        );

        // A change from outside Muna (brightness keys) is not a recorded set.
        fake.set_brightness_state(r"\\.\DISPLAY1#0", 55);
        assert_eq!(fake.brightness().monitors().unwrap()[0].percent, 55);
        assert_eq!(fake.brightness_sets().len(), 1);
        fake.set_brightness_state("unknown", 1);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::BrightnessChanged {
                monitor_id: r"\\.\DISPLAY1#0".into(),
                percent: 55
            }
        );
        assert!(rx.try_recv().is_err(), "unknown monitors publish nothing");
    }

    #[test]
    fn osd_suppression_is_recorded_and_reports_unavailable_builds() {
        let fake = FakePlatform::new();
        assert_eq!(fake.system_osd().state(), OsdState::Native);
        assert_eq!(
            fake.system_osd().set_suppressed(true).unwrap(),
            OsdState::Suppressed
        );
        assert_eq!(fake.system_osd().state(), OsdState::Suppressed);
        assert_eq!(
            fake.system_osd().set_suppressed(false).unwrap(),
            OsdState::Native
        );
        assert_eq!(fake.osd_requests(), vec![true, false]);

        fake.set_osd_unavailable(true);
        assert_eq!(fake.system_osd().state(), OsdState::Unavailable);
        assert_eq!(
            fake.system_osd().set_suppressed(true).unwrap(),
            OsdState::Unavailable
        );
    }

    #[test]
    fn battery_and_foreground_scripts_round_trip() {
        let fake = FakePlatform::new();
        let battery = BatteryState {
            percent: Some(42),
            source: PowerSource::Battery,
            charging: false,
        };
        fake.set_battery(battery);
        assert_eq!(fake.power().battery().unwrap(), battery);

        let window = ForegroundWindow {
            handle: 42,
            title: "Game".into(),
            process_name: "game.exe".into(),
            bounds: Rect::new(0, 0, 2560, 1440),
            is_fullscreen: true,
        };
        fake.foreground_changed(window.clone());
        assert_eq!(fake.foreground().current().unwrap(), Some(window));
    }

    #[test]
    fn system_samples_play_in_order_then_hold_the_last_reading() {
        let fake = FakePlatform::new();
        assert!(matches!(
            fake.system_stats().sample(0),
            Err(PlatformError::Unsupported("system stats"))
        ));

        let reading = |cpu: f32| SystemSample {
            cpu_percent: Some(cpu),
            logical_cpus: 8,
            processes: vec![
                crate::types::ProcessUsage {
                    name: "muna".into(),
                    cpu_percent: 1.0,
                    memory_bytes: 1,
                    count: 1,
                },
                crate::types::ProcessUsage {
                    name: "idle".into(),
                    cpu_percent: 0.5,
                    memory_bytes: 1,
                    count: 1,
                },
            ],
            ..SystemSample::default()
        };
        fake.script_system_samples(vec![reading(10.0), reading(20.0)]);

        let first = fake.system_stats().sample(0).unwrap();
        assert_eq!(first.cpu_percent, Some(10.0));
        assert!(first.processes.is_empty(), "no process walk was asked for");
        let second = fake.system_stats().sample(1).unwrap();
        assert_eq!(second.cpu_percent, Some(20.0));
        assert_eq!(second.processes.len(), 1);
        let third = fake.system_stats().sample(5).unwrap();
        assert_eq!(third.cpu_percent, Some(20.0), "the last reading repeats");
        assert_eq!(third.processes.len(), 2);
        assert_eq!(
            fake.system_sample_requests(),
            vec![0, 0, 1, 5],
            "the unsupported attempt counts too: the module did ask"
        );
    }

    #[test]
    fn foreground_handle_never_crosses_the_ipc_boundary() {
        let window = ForegroundWindow {
            handle: 42,
            title: "Game".into(),
            process_name: "game.exe".into(),
            bounds: Rect::default(),
            is_fullscreen: false,
        };
        let json = serde_json::to_value(&window).unwrap();
        assert!(json.get("handle").is_none());
    }

    #[test]
    fn app_bar_reservations_are_tracked_per_window() {
        let fake = FakePlatform::new();
        let monitor = Rect::new(0, 0, 2560, 1440);
        let granted = fake.app_bar().reserve_top(7, monitor, 32).unwrap();
        assert_eq!(granted, Rect::new(0, 0, 2560, 32));
        fake.app_bar().reserve_top(7, monitor, 26).unwrap();
        assert_eq!(fake.app_bars(), vec![(7, Rect::new(0, 0, 2560, 26))]);
        fake.app_bar().release(7).unwrap();
        fake.app_bar().release(7).unwrap();
        assert!(fake.app_bars().is_empty());
        assert_eq!(
            fake.windowing_calls(),
            vec![
                WindowingCall::ReserveAppBar(7, monitor, 32),
                WindowingCall::ReserveAppBar(7, monitor, 26),
                WindowingCall::ReleaseAppBar(7),
            ],
            "releasing an unregistered window records nothing"
        );
    }

    #[test]
    fn autostart_round_trips_and_honours_a_user_denial() {
        let fake = FakePlatform::new();
        assert_eq!(fake.autostart().mechanism(), AutostartMechanism::None);
        assert!(!fake.autostart().is_enabled().unwrap());
        fake.autostart().set_enabled(true).unwrap();
        assert!(fake.autostart().is_enabled().unwrap());
        fake.autostart().set_enabled(false).unwrap();
        fake.set_autostart_denied(true);
        assert_eq!(
            fake.autostart().set_enabled(true),
            Err(PlatformError::AccessDenied("startup task"))
        );
        assert!(!fake.autostart().is_enabled().unwrap());
    }

    #[test]
    fn move_size_and_lock_scripts_publish_events() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();
        fake.move_size_changed(true);
        fake.set_session_locked(true);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::MoveSizeChanged { started: true }
        );
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::SessionLockChanged { locked: true }
        );
    }

    #[test]
    fn events_before_subscribe_are_not_replayed() {
        let fake = FakePlatform::new();
        fake.set_session_locked(true);
        let mut rx = fake.subscribe();
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn windowing_records_calls_and_answers_hit_tests_from_moved_rects() {
        let fake = FakePlatform::new();
        let windowing = fake.windowing();
        windowing
            .move_async(7, Rect::new(100, 0, 1000, 440))
            .unwrap();
        windowing.assert_topmost(7).unwrap();

        assert_eq!(
            windowing.window_rect(7).unwrap(),
            Rect::new(100, 0, 1000, 440)
        );
        assert_eq!(windowing.window_at(500, 10).unwrap(), 7);
        assert_eq!(windowing.window_at(5, 10).unwrap(), 0);
        assert_eq!(
            fake.windowing_calls(),
            vec![
                WindowingCall::MoveAsync(7, Rect::new(100, 0, 1000, 440)),
                WindowingCall::AssertTopmost(7),
            ]
        );

        fake.set_user_notification_state(UserNotificationState::Busy);
        assert!(
            windowing
                .user_notification_state()
                .unwrap()
                .suppresses_overlay()
        );
    }

    #[test]
    fn default_platform_is_available_everywhere() {
        let platform = crate::default_platform();
        let expected = if cfg!(windows) { "windows" } else { "fake" };
        assert_eq!(platform.name(), expected);
        // Every service is reachable even where it is not implemented yet.
        let _ = platform.monitors().all();
    }
}
